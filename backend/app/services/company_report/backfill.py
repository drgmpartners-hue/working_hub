"""과거 데이터 구축(백필) 완성판(기획 7-5, P2-11) + 검증 결과서.

순서: 네이버(필수어 + 필수어×보조어 조합) → 구글 뉴스 RSS(주 단위, 100건이면 쪼갬) → DART 기간 공시
→ 정제·저장(출처가 달라도 같은 기사는 묶음) → 요약 → 사실 추출 → 검증 ①~⑥ → 판정 → 결과서 PDF
기업당 수 분~수십 분, 웹 서비스의 백그라운드 작업으로 돈다(진행률은 backfill_jobs.progress).
"""
from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, timedelta
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.news_briefing import BackfillJob, NewsArticle, PortfolioCompany
from app.services.collectors import google_news_rss
from app.services.company_report import collector, coverage_check as cc, facts, summarizer
from app.services.company_report.dedup import relevance
from app.services.company_report.timeutil import now_kst, today_kst
from app.services.company_report.keys import release

logger = logging.getLogger(__name__)
# 과거 데이터 구축은 한 번에 하나씩(여러 기업을 연달아 등록해도 DB 연결·외부 API 한도를 넘지 않게)
_RUN_LOCK = asyncio.Lock()
VERDICT_LABEL = {"sufficient": "충분", "needs_more": "보완 필요", "insufficient": "부족"}


async def _progress(db: AsyncSession, job: BackfillJob, pct: int, stage: str) -> None:
    job.progress = pct
    job.coverage = {**(job.coverage or {}), "stage": stage}
    await db.commit()


def _relevant(items: list[dict], kw: dict, start: date, end: date) -> list[dict]:
    out = []
    lo, hi = datetime.combine(start, datetime.min.time()), datetime.combine(end + timedelta(days=1), datetime.min.time())
    for it in items:
        p = it.get("published_at")
        if p and not (lo <= p < hi):
            continue
        rel = relevance(it["title"], it.get("description", ""), kw["required"], kw["boost"], kw["exclude"])
        if not rel.excluded:
            out.append(it)
    return out


async def _google(kw: dict, start: date, end: date) -> dict:
    items, saturated, errors, windows = [], [], 0, 0
    for term in kw["required"][:2]:
        r = await google_news_rss.search_range(f'"{term}"', start, end)
        items += r["items"]
        saturated += r["saturated"]
        errors += r["errors"]
        windows += r["windows"]
    return {"items": items, "saturated": sorted(set(saturated)), "errors": errors, "windows": windows}


async def _recover_events(db: AsyncSession, company: PortfolioCompany, kw: dict, missing: list[dict]) -> int:
    """③에서 빠진 핵심 사건: 사건 날짜 ±7일로 구글 RSS를 다시 찾아 저장(자동 추가)."""
    added = 0
    for ev in missing[:8]:
        d = cc._parse_date(ev.get("date"))
        if not d:
            continue
        await release(db)
        r = await google_news_rss.search_range(f'"{company.name}"', d - timedelta(days=7), d + timedelta(days=7), step_days=15)
        items = [it for it in r["items"] if not relevance(it["title"], it.get("description", ""), kw["required"], kw["boost"], kw["exclude"]).excluded]
        if items:
            s = await collector._store(db, company.id, items, kw, via="backfill")
            added += s["new"]
    await db.commit()
    return added


async def run_backfill(db: AsyncSession, company_id: str, *, date_from: Optional[date] = None, date_to: Optional[date] = None,
                       months: int = 6, trigger: str = "manual", user_id: Optional[str] = None,
                       job_id: Optional[str] = None, with_ai_checks: bool = True) -> dict:
    company = await db.get(PortfolioCompany, company_id)
    if not company:
        return {"error": "기업 없음"}
    end = date_to or today_kst()
    start = date_from or (end - timedelta(days=30 * max(1, min(months, 12))))
    job = await db.get(BackfillJob, job_id) if job_id else None
    if not job:
        job = BackfillJob(company_id=company_id, period_from=start, period_to=end, trigger=trigger, status="queued", created_by=user_id)
        db.add(job)
    job.period_from, job.period_to, job.error = start, end, None
    if _RUN_LOCK.locked():
        job.status = "queued"
        job.coverage = {**(job.coverage or {}), "stage": "앞 기업 작업이 끝나기를 기다리는 중"}
    await db.commit()
    async with _RUN_LOCK:
        job.status = "running"
        await db.commit()
        return await _run_locked(db, company, job, start, end, with_ai_checks)


async def _run_locked(db: AsyncSession, company: PortfolioCompany, job: BackfillJob, start: date, end: date,
                      with_ai_checks: bool) -> dict:
    company_id = company.id
    try:
        kw = await collector._keywords(db, company_id)
        if not kw["required"]:
            kw["required"] = [company.name]

        await _progress(db, job, 5, "네이버 조합 검색")
        naver_raw, hit = await collector._fetch_naver(db, kw, datetime.combine(start, datetime.min.time()), combos=True)
        await _progress(db, job, 25, "구글 뉴스 RSS 기간 검색")
        await release(db)
        g = await _google(kw, start, end)
        await _progress(db, job, 45, "DART 공시")
        dart = await collector._fetch_dart(db, company, start, end)

        naver_rel = _relevant(naver_raw, kw, start, end)
        google_rel = _relevant(g["items"], kw, start, end)
        recall = cc.estimate_recall(naver_rel, google_rel)

        await _progress(db, job, 55, "정제·저장")
        stats = await collector._store(db, company_id, naver_raw + g["items"] + dart, kw, via="backfill")
        company.last_collected_at = company.last_collected_at or now_kst()
        await db.commit()
        job.source_stats = {"naver": len(naver_raw), "naver_relevant": len(naver_rel), "google_rss": len(g["items"]),
                            "google_relevant": len(google_rel), "google_windows": g["windows"], "google_errors": g["errors"],
                            "dart": len(dart), **stats}

        await _progress(db, job, 65, "요약")
        await summarizer.summarize_pending(db, company_id=company_id, limit=1500)
        await _progress(db, job, 75, "사실 추출")
        await facts.extract_pending(db, company_id=company_id, limit=1500)

        await _progress(db, job, 82, "검증")
        checks = await run_checks(db, job, company, kw, hit, g, recall, dart, with_ai_checks=with_ai_checks)
        job.status, job.progress, job.finished_at = "done", 100, now_kst()
        job.coverage = {**(job.coverage or {}), "stage": "완료"}
        await db.commit()
        await save_report(db, job, company)
        return {"job_id": job.id, "verdict": job.verdict, **stats, "checks": {k: v.get("pass") for k, v in checks.items()}}
    except Exception as e:
        logger.exception("백필 실패(%s): %s", company.name, e)
        await db.rollback()
        job = await db.get(BackfillJob, job.id)
        if job:
            job.status, job.error, job.finished_at = "failed", str(e)[:1000], now_kst()
            await db.commit()
        return {"error": str(e)}


async def run_checks(db: AsyncSession, job: BackfillJob, company: PortfolioCompany, kw: dict, hit: list[str], g: dict,
                     recall: dict, dart: list[dict], with_ai_checks: bool = True) -> dict:
    start, end = job.period_from, job.period_to
    arts = await cc.period_articles(db, company.id, start, end)
    reps = [a for a in arts if a["is_representative"]]
    cov = cc.coverage_counts([a["published_at"] for a in reps if a["published_at"]], start, end)
    confirmed = set((job.coverage or {}).get("confirmed_gaps") or [])
    gaps = [m for m in cov["zero_months"] if m not in confirmed]
    c1_ok = not gaps and not g["saturated"] and (not hit or g["errors"] == 0)
    notes = []
    if gaps:
        notes.append(f"기사 0건인 달 {', '.join(gaps)}(실제로 없으면 '기사 없음 확인')")
    if hit:
        notes.append(f"네이버 1,000건 한도 도달 {len(hit)}개 검색어" + (" — 구글 RSS로 보완" if g["errors"] == 0 else " — 구글 RSS 일부 실패"))
    if g["saturated"]:
        notes.append(f"하루 100건 초과 {len(g['saturated'])}일(구글)")
    checks = {"c1": {"pass": c1_ok, "note": "; ".join(notes) or "모든 달에 기사 있음", "zero_months": cov["zero_months"],
                     "hit_limit": hit, "saturated": g["saturated"], "google_ok": g["errors"] == 0}}

    r = recall.get("recall")
    checks["c2"] = {"pass": None if r is None else r >= cc.RECALL_PASS, **recall,
                    "note": "겹치는 기사가 없어 추정 불가(참고 지표)" if r is None else f"추정 수집률 {r:.0%}"}

    ev_result: dict = {"events": [], "errors": {}, "sources": {}}
    if with_ai_checks:
        ev_result = await cc.key_events(db, company, start, end)
    matched = cc.match_events(ev_result["events"], arts)
    missing = [e for e in matched if not e["found"]]
    recovered = 0
    if missing:
        recovered = await _recover_events(db, company, kw, missing)
        if recovered:
            await summarizer.summarize_pending(db, company_id=company.id, limit=300)
            await facts.extract_pending(db, company_id=company.id, limit=300)
            arts = await cc.period_articles(db, company.id, start, end)
            matched = cc.match_events(ev_result["events"], arts)
            missing = [e for e in matched if not e["found"]]
    checks["c3"] = {"pass": (not missing) if ev_result["events"] else (None if ev_result["errors"] or not with_ai_checks else True),
                    "note": f"핵심 사건 {len(matched)}건 중 누락 {len(missing)}건" + (f"(자동 추가 {recovered}건 후)" if recovered else ""),
                    "errors": ev_result["errors"]}
    job.key_events = {"events": matched, "sources": ev_result["sources"], "recovered": recovered}

    if company.corp_code:
        stored = sum(1 for a in arts if a["source_type"] == "dart")
        # 표시하지 않은(숨김) 공시도 수집은 된 것 → 전체로 센다
        total_dart = (await db.execute(select(NewsArticle.id).where(
            NewsArticle.company_id == company.id, NewsArticle.source_type == "dart",
            NewsArticle.published_at >= datetime.combine(start, datetime.min.time()),
            NewsArticle.published_at < datetime.combine(end + timedelta(days=1), datetime.min.time()),
        ))).all()
        checks["c4"] = {"pass": len(total_dart) >= len(dart), "dart_list": len(dart), "stored": len(total_dart),
                        "note": f"DART {len(dart)}건 / 수집 {len(total_dart)}건 (표시 {stored})"}
    else:
        checks["c4"] = {"pass": None, "note": "DART 등록사 아님(해당 없음)"}

    prev = job.sample_review or {}
    sample = prev.get("items") or cc.pick_sample(arts)
    answers = prev.get("answers") or {}
    acc = _accuracy(answers)
    job.sample_review = {"items": sample, "answers": answers, "accuracy": acc}
    checks["c5"] = {"pass": None if acc is None else acc >= cc.SAMPLE_PASS,
                    "note": "담당자 확인 대기" if acc is None else f"정확도 {acc:.0%} ({len(answers)}건)"}

    checks["c6"] = await cc.facts_check(db, company.id, matched)
    _finalize(job, checks, len(reps))
    return checks


def _accuracy(answers: dict) -> Optional[float]:
    if not answers:
        return None
    vals = [bool(v) for v in answers.values()]
    return round(sum(vals) / len(vals), 3)


def _finalize(job: BackfillJob, checks: dict, total: int) -> None:
    verdict, reasons = cc.decide(checks, total)
    job.verdict = verdict
    rec = (checks.get("c2") or {}).get("recall")
    job.estimated_recall = rec
    job.coverage = {**(job.coverage or {}), "checks": checks, "reasons": reasons, "total_articles": total}


async def refresh_verdict(db: AsyncSession, job: BackfillJob) -> None:
    """샘플 검수·빈 달 확인 뒤 다시 판정(검색·AI 호출 없이)."""
    cov = job.coverage or {}
    checks = dict(cov.get("checks") or {})
    arts = await cc.period_articles(db, job.company_id, job.period_from, job.period_to)
    reps = [a for a in arts if a["is_representative"]]
    counts = cc.coverage_counts([a["published_at"] for a in reps if a["published_at"]], job.period_from, job.period_to)
    confirmed = set(cov.get("confirmed_gaps") or [])
    c1 = dict(checks.get("c1") or {})
    gaps = [m for m in counts["zero_months"] if m not in confirmed]
    c1["zero_months"] = counts["zero_months"]
    c1["pass"] = not gaps and not c1.get("saturated") and (not c1.get("hit_limit") or c1.get("google_ok", False))
    c1["note"] = f"확인 안 된 빈 달 {', '.join(gaps)}" if gaps else "빈 달 없음(또는 담당자 확인)"
    checks["c1"] = c1
    acc = _accuracy((job.sample_review or {}).get("answers") or {})
    checks["c5"] = {"pass": None if acc is None else acc >= cc.SAMPLE_PASS,
                    "note": "담당자 확인 대기" if acc is None else f"정확도 {acc:.0%}"}
    job.sample_review = {**(job.sample_review or {}), "accuracy": acc}
    _finalize(job, checks, len(reps))
    await db.commit()


async def monthly_counts(db: AsyncSession, job: BackfillJob) -> dict:
    arts = await cc.period_articles(db, job.company_id, job.period_from, job.period_to)
    reps = [a for a in arts if a["is_representative"]]
    by_source: dict[str, int] = {}
    for a in arts:
        by_source[a["source"]] = by_source.get(a["source"], 0) + 1
    return {**cc.coverage_counts([a["published_at"] for a in reps if a["published_at"]], job.period_from, job.period_to),
            "by_source": by_source, "representative": len(reps), "all": len(arts)}


async def save_report(db: AsyncSession, job: BackfillJob, company: PortfolioCompany) -> None:
    """검증 결과서 PDF → 기업DB 01_기업정보/{기업명}_수집검증_{기간}.pdf"""
    try:
        from app.services.company_report import company_db

        cov = job.coverage or {}
        checks = cov.get("checks") or {}
        counts = await monthly_counts(db, job)
        st = job.source_stats or {}
        rows = [["검사", "결과", "내용"]]
        names = {"c1": "① 기간 커버리지", "c2": "② 출처 간 대조", "c3": "③ 핵심 사건", "c4": "④ DART 대조", "c5": "⑤ 샘플 검수", "c6": "⑥ 사실 추출"}
        for k, label in names.items():
            c = checks.get(k) or {}
            rows.append([label, {True: "통과", False: "미통과", None: "대기·해당 없음"}[c.get("pass")], c.get("note", "")])
        blocks = [
            ("p", f"기간 {job.period_from} ~ {job.period_to} · 판정: {VERDICT_LABEL.get(job.verdict or '', '-')} · 만든 시각 {now_kst():%Y-%m-%d %H:%M}"),
            ("h", "판정 사유"), ("p", "\n".join(cov.get("reasons") or ["모든 검사 통과"])),
            ("h", "검사 결과"), ("table", rows),
            ("h", "출처별 수집"), ("table", [["출처", "건수"], ["네이버(관련)", st.get("naver_relevant", 0)],
                                         ["구글 뉴스 RSS(관련)", st.get("google_relevant", 0)], ["DART 공시", st.get("dart", 0)],
                                         ["저장(신규)", st.get("new", 0)], ["다른 출처와 같은 기사(묶음)", st.get("attached", 0)],
                                         ["제외어로 제외", st.get("excluded", 0)]]),
            ("h", "월별 기사 수(대표 기사)"), ("table", [["월", "건수"]] + [[m, n] for m, n in counts["monthly"].items()]),
        ]
        evs = (job.key_events or {}).get("events") or []
        if evs:
            blocks += [("h", "핵심 사건 대조"), ("table", [["날짜", "사건", "수집"]] + [[e.get("date") or "-", e.get("title", ""), "있음" if e.get("found") else "없음"] for e in evs])]
        pdf = company_db._pdf(f"{company.name} 수집 검증 결과서", blocks)
        period = f"{job.period_from:%Y%m%d}-{job.period_to:%Y%m%d}"
        f = await company_db.save_auto(db, company_id=company.id, folder="info", doc_kind="수집검증", period_label=period, ext="pdf",
                                       data=pdf, auto_key=f"backfill_pdf:{job.id}", related_type="backfill", related_id=job.id)
        job.report_file_id = f.id
        await db.commit()
    except Exception as e:
        logger.warning("검증 결과서 저장 실패: %s", e)
        await db.rollback()


async def fail_stale_jobs() -> int:
    """서버가 다시 켜질 때: 진행 중·대기로 남은 작업은 중단된 것이므로 실패로 표시(다시 실행 가능하게)."""
    from sqlalchemy import update

    from app.db.session import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        res = await db.execute(update(BackfillJob).where(BackfillJob.status.in_(["queued", "running"])).values(
            status="failed", error="서버 재시작으로 중단되었습니다. [과거 데이터 가져오기]로 다시 실행하세요.", finished_at=now_kst()))
        await db.commit()
        return res.rowcount or 0
