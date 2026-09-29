"""월간 브리핑(기획 5장 '월간 브리핑 형식', 9장 '월간') — P3.

순서(매월 1일 03:00 KST, 지난 달 대상)
1. 포트폴리오 동향: 기업별 기사 수·긍정/주의, 전월 대비, 커버리지 점검(갑자기 기사가 끊긴 기업)
2. 기업별 월간 요약(Claude): 이달의 주요 사실·의미(분석)·고객 설명·예상 질문·주의·체크포인트 — 문장마다 출처 id
3. 월간 종합(Claude): 이달의 요약 3~5문장 + 주목할 기업
4. 교차 검토(Gemini 1차 → Claude 2차): 기업 묶음별로 나눠 검토, 합의 안 된 문장은 삭제
5. 저장: company_monthly_digests(기업별) + monthly_briefings(ready)
   검토 실패 또는 삭제 문장 30% 초과 → held(보류), 관리자가 확인 후 [발송 허용]
발송은 sender.send_monthly: 1일 이후 첫 영업일의 08:30 배치(데일리와 같은 시각)에 보낸다.
"""
from __future__ import annotations

import asyncio
import logging
import re
from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Any, Optional

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.company_report import CompanyFact, CompanyFundingRound, CompanyMonthlyDigest, MonthlyBriefing
from app.models.news_briefing import NewsArticle, PortfolioCompany
from app.services import llm_client
from app.services.company_report import config, cross_review, search
from app.services.company_report.keys import get_service_key, release
from app.services.company_report.timeutil import now_kst, today_kst

logger = logging.getLogger(__name__)

MAX_ARTICLES_PER_COMPANY = 15
MAX_FACTS_PER_COMPANY = 10
HOLD_RATIO = 0.30
REVIEW_CHUNK_COMPANIES = 6
AI_CONCURRENCY = 4
TAG_ORDER = {"caution": 0, "positive": 1, "neutral": 2, None: 3}
MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


# --------------------------------------------------------------------------- 날짜 도우미(순수)

def month_of(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def prev_month(month: str) -> str:
    y, m = int(month[:4]), int(month[5:7])
    return f"{y - 1:04d}-12" if m == 1 else f"{y:04d}-{m - 1:02d}"


def next_month(month: str) -> str:
    y, m = int(month[:4]), int(month[5:7])
    return f"{y + 1:04d}-01" if m == 12 else f"{y:04d}-{m + 1:02d}"


def month_bounds(month: str) -> tuple[datetime, datetime]:
    """[이번 달 1일 00:00, 다음 달 1일 00:00)"""
    start = datetime(int(month[:4]), int(month[5:7]), 1)
    nm = next_month(month)
    return start, datetime(int(nm[:4]), int(nm[5:7]), 1)


def month_label(month: str) -> str:
    return f"{int(month[5:7])}월"


def target_month_for(day: date) -> str:
    """오늘 기준 월간 브리핑 대상 = 지난 달."""
    return prev_month(month_of(day))


# --------------------------------------------------------------------------- 1. 포트폴리오 동향

async def _monthly_counts(db: AsyncSession, company_ids: list[str], months: list[str]) -> dict[tuple[str, str], dict]:
    """(company_id, month) → {total, positive, neutral, caution}"""
    if not company_ids:
        return {}
    start, _ = month_bounds(min(months))
    _, end = month_bounds(max(months))
    ym = func.to_char(NewsArticle.published_at, "YYYY-MM")
    rows = (await db.execute(
        select(NewsArticle.company_id, ym, NewsArticle.tag, func.count())
        .where(NewsArticle.company_id.in_(company_ids), NewsArticle.is_hidden == False,  # noqa: E712
               NewsArticle.is_representative == True,  # noqa: E712
               NewsArticle.published_at >= start, NewsArticle.published_at < end)
        .group_by(NewsArticle.company_id, ym, NewsArticle.tag)
    )).all()
    out: dict[tuple[str, str], dict] = defaultdict(lambda: {"total": 0, "positive": 0, "neutral": 0, "caution": 0})
    for cid, m, tag, n in rows:
        d = out[(cid, m)]
        d["total"] += n
        if tag in ("positive", "neutral", "caution"):
            d[tag] += n
    return out


def coverage_alerts(rows: list[dict]) -> list[dict]:
    """갑자기 기사가 끊긴 기업(수집 누락 의심). 순수 함수.
    직전 3개월 평균이 3건 이상인데 이번 달 0건, 또는 평균 5건 이상인데 30% 미만."""
    out = []
    for r in rows:
        avg = r.get("avg3") or 0
        n = r.get("total") or 0
        if (avg >= 3 and n == 0) or (avg >= 5 and n < avg * 0.3):
            out.append({"company_id": r["company_id"], "name": r["name"], "total": n, "avg3": round(avg, 1),
                        "note": "기사가 크게 줄었습니다. 검색어·수집 상태를 확인하세요."})
    return out


async def portfolio_stats(db: AsyncSession, month: str, companies: list[PortfolioCompany]) -> dict:
    pm = prev_month(month)
    hist = [prev_month(pm), pm]
    hist.insert(0, prev_month(hist[0]))  # 직전 3개월
    counts = await _monthly_counts(db, [c.id for c in companies], [hist[0], month])
    rows = []
    for c in companies:
        cur = counts.get((c.id, month), {"total": 0, "positive": 0, "neutral": 0, "caution": 0})
        prev = counts.get((c.id, pm), {"total": 0, "caution": 0})
        avg3 = sum(counts.get((c.id, m), {"total": 0})["total"] for m in hist) / 3
        rows.append({
            "company_id": c.id, "name": c.name, **cur,
            "prev_total": prev["total"], "prev_caution": prev.get("caution", 0),
            "change": cur["total"] - prev["total"], "avg3": round(avg3, 1),
        })
    rows.sort(key=lambda r: (-r["total"], r["name"]))
    total = sum(r["total"] for r in rows)
    return {
        "month": month, "prev_month": pm,
        "company_total": len(companies),
        "company_with_news": sum(1 for r in rows if r["total"]),
        "article_count": total,
        "positive_count": sum(r["positive"] for r in rows),
        "caution_count": sum(r["caution"] for r in rows),
        "prev_article_count": sum(r["prev_total"] for r in rows),
        "companies": rows,
        "coverage_alerts": coverage_alerts(rows),
    }


# --------------------------------------------------------------------------- 2. 출처 모으기

async def gather_sources(db: AsyncSession, month: str, companies: list[PortfolioCompany]) -> tuple[dict[str, list[dict]], dict[str, dict]]:
    """기업별 출처 목록(A#=기사, F#=원장 사실)과 전체 출처 표(id → 정보)."""
    start, end = month_bounds(month)
    ids = [c.id for c in companies]
    arts = (await db.execute(
        select(NewsArticle).where(
            NewsArticle.company_id.in_(ids or [""]), NewsArticle.is_hidden == False,  # noqa: E712
            NewsArticle.is_representative == True,  # noqa: E712
            NewsArticle.published_at >= start, NewsArticle.published_at < end)
    )).scalars().all()
    facts = (await db.execute(
        select(CompanyFact).where(
            CompanyFact.company_id.in_(ids or [""]), CompanyFact.status.in_(["candidate", "confirmed"]),
            CompanyFact.fact_date >= start.date(), CompanyFact.fact_date < end.date())
    )).scalars().all()
    rounds = (await db.execute(
        select(CompanyFundingRound).where(
            CompanyFundingRound.company_id.in_(ids or [""]), CompanyFundingRound.status != "rejected",
            CompanyFundingRound.round_date >= start.date(), CompanyFundingRound.round_date < end.date())
    )).scalars().all()

    by_a: dict[str, list[NewsArticle]] = defaultdict(list)
    for a in arts:
        by_a[a.company_id].append(a)
    by_f: dict[str, list] = defaultdict(list)
    for f in facts:
        by_f[f.company_id].append(f)
    by_r: dict[str, list] = defaultdict(list)
    for r in rounds:
        by_r[r.company_id].append(r)

    per_company: dict[str, list[dict]] = {}
    table: dict[str, dict] = {}
    na = nf = 0
    for c in companies:
        lst: list[dict] = []
        al = sorted(by_a.get(c.id, []), key=lambda a: (TAG_ORDER.get(a.tag, 3), -(a.relevance_score or 0),
                                                       -(a.published_at or datetime.min).timestamp()))
        for a in al[:MAX_ARTICLES_PER_COMPANY]:
            na += 1
            sid = f"A{na}"
            d = a.published_at.date().isoformat() if a.published_at else ""
            text = f"[{c.name}] ({d}, {a.tag or '-'}, {a.issue_type or '-'}) {a.title} — {a.summary or a.description or ''}"
            lst.append({"id": sid, "company_id": c.id, "text": text})
            table[sid] = {"type": "article", "id": a.id, "company_id": c.id, "title": a.title, "url": a.url,
                          "date": d, "press": a.press, "tag": a.tag}
        fl = sorted(by_f.get(c.id, []), key=lambda f: (f.status != "confirmed", f.fact_date or date.min))
        for f in fl[:MAX_FACTS_PER_COMPANY]:
            nf += 1
            sid = f"F{nf}"
            d = f.fact_date.isoformat() if f.fact_date else ""
            st = "확정" if f.status == "confirmed" else "후보"
            lst.append({"id": sid, "company_id": c.id, "text": f"[{c.name}] 원장 사실({st}, {f.fact_type}, {d}) {f.title}"})
            table[sid] = {"type": "fact", "id": f.id, "company_id": c.id, "title": f.title, "date": d, "status": f.status}
        for r in by_r.get(c.id, []):
            nf += 1
            sid = f"F{nf}"
            amt = f"{r.amount / 1e8:,.0f}억 원" if r.amount else "금액 비공개"
            inv = ", ".join(i.get("name", "") for i in (r.investors or []) if isinstance(i, dict))
            d = r.round_date.isoformat() if r.round_date else ""
            lst.append({"id": sid, "company_id": c.id, "text": f"[{c.name}] 투자유치({d}) {r.round_name or ''} {amt} {inv}".strip()})
            table[sid] = {"type": "funding", "id": r.id, "company_id": c.id, "title": f"{r.round_name or '투자유치'} {amt}", "date": d}
        if lst:
            per_company[c.id] = lst
    return per_company, table


# --------------------------------------------------------------------------- 3. AI 작성

DIGEST_PROMPT = """너는 벤처캐피탈 운용사의 애널리스트다. 영업 직원이 고객(투자자)에게 설명할 수 있도록 투자기업의 한 달을 정리한다.
대상: {name}{industry} / 기간: {label}({month})
아래 [출처]만 근거로 써라. 출처에 없는 사실·숫자·전망은 쓰지 마라. 문장마다 근거 출처 id를 source_ids에 단다.
문체: 짧은 평서문(~했다/~이다), 두괄식, 고등학생도 이해할 쉬운 말. 과장·투자 권유·수익 보장 표현 금지.

[출처]
{sources}

[전월 요약]
{prev}

작성할 것
- summary: 이달의 핵심 2~3문장
- facts: 이달의 주요 사실 최대 5개(날짜 순). date는 YYYY-MM-DD(모르면 "")
- meaning: 이 사실들이 회사에 어떤 의미인지 1~2문장(출처에 근거한 해석. 확인되지 않은 전망은 쓰지 않음)
- client_explain: "고객에게 이렇게 설명하세요" 1~2문장(고객에게 그대로 말할 수 있는 말투: ~했습니다)
- qa: 고객이 물을 만한 질문과 답 최대 2개
- caution: 주의가 필요한 일이 있으면 what(무슨 일)·impact(예상 영향)·check(회사에 확인할 것), 없으면 null
- checkpoints: 출처에 나온 앞으로의 예정 일정(출시·계약·투자 라운드·상장 등). when은 "YYYY-MM" 또는 "", 없으면 []

출력 JSON
{{"summary": [{{"text": "...", "source_ids": ["A1"]}}],
  "facts": [{{"date": "2026-09-03", "text": "...", "source_ids": ["A1"]}}],
  "meaning": {{"text": "...", "source_ids": ["A1"]}},
  "client_explain": {{"text": "...", "source_ids": ["A1"]}},
  "qa": [{{"q": "...", "a": "...", "source_ids": ["A2"]}}],
  "caution": null,
  "checkpoints": [{{"when": "2026-11", "text": "...", "source_ids": ["A3"]}}]}}
caution 예: {{"what": {{"text": "...", "source_ids": ["A4"]}}, "impact": {{"text": "...", "source_ids": ["A4"]}}, "check": {{"text": "...", "source_ids": ["A4"]}}}}"""

OVERALL_PROMPT = """너는 벤처캐피탈 운용사의 애널리스트다. {label}({month}) 투자기업 월간 브리핑의 앞부분을 쓴다.
아래 [포트폴리오 동향]과 [기업별 월간 정리]만 근거로 써라. 기업별 정리의 문장에 붙은 출처 id를 그대로 근거로 단다.
문체: 짧은 평서문, 두괄식, 쉬운 말. 과장·투자 권유 금지.

[포트폴리오 동향]
{stats}

[기업별 월간 정리]
{digests}

작성할 것
- summary: 포트폴리오 전체에서 지난 달 가장 중요한 일 3~5문장(주의 이슈를 먼저)
- highlights: 주목할 기업 최대 5곳, 기업마다 한 문장(무엇 때문에 주목하는지)

출력 JSON
{{"summary": [{{"text": "...", "source_ids": ["A1"]}}],
  "highlights": [{{"company_id": "...", "text": "...", "source_ids": ["A1"]}}]}}"""


def _sent(obj: Any) -> Optional[dict]:
    if isinstance(obj, dict) and str(obj.get("text") or "").strip():
        return {"text": str(obj["text"]).strip(), "source_ids": [str(x) for x in (obj.get("source_ids") or [])]}
    return None


def digest_sentences(cidx: int, company_id: str, d: dict) -> list[dict]:
    """기업 요약 JSON → 검토용 문장 목록(순수). id 규칙: c{n}_{종류}{번호}"""
    p = f"c{cidx}_"
    out: list[dict] = []

    def add(sid: str, kind: str, obj: Any, **extra):
        s = _sent(obj)
        if s:
            out.append({"id": p + sid, "section": f"company:{kind}", "company_id": company_id, **s, **extra})

    for i, s in enumerate(d.get("summary") or [], 1):
        add(f"s{i}", "summary", s)
    for i, s in enumerate(d.get("facts") or [], 1):
        if isinstance(s, dict):
            add(f"f{i}", "fact", s, date=str(s.get("date") or "")[:10])
    add("m", "meaning", d.get("meaning"))
    add("x", "client_explain", d.get("client_explain"))
    for i, q in enumerate(d.get("qa") or [], 1):
        if isinstance(q, dict) and q.get("q") and q.get("a"):
            add(f"q{i}", "qa", {"text": f"Q. {q['q']} A. {q['a']}", "source_ids": q.get("source_ids")},
                q=str(q["q"]), a=str(q["a"]))
    cau = d.get("caution")
    if isinstance(cau, dict):
        for key, code in (("what", "w"), ("impact", "i"), ("check", "k")):
            add(code, f"caution_{key}", cau.get(key))
    for i, c in enumerate(d.get("checkpoints") or [], 1):
        if isinstance(c, dict):
            add(f"p{i}", "checkpoint", c, when=str(c.get("when") or "")[:7])
    return out


def overall_sentences(d: dict) -> list[dict]:
    out = []
    for i, s in enumerate(d.get("summary") or [], 1):
        x = _sent(s)
        if x:
            out.append({"id": f"o{i}", "section": "summary", **x})
    for i, s in enumerate(d.get("highlights") or [], 1):
        x = _sent(s)
        if x and isinstance(s, dict):
            out.append({"id": f"h{i}", "section": "highlight", "company_id": s.get("company_id"), **x})
    return out


def rebuild_company(sentences: list[dict]) -> dict:
    """검토를 통과한 문장으로 기업 정리를 다시 만든다(순수)."""
    c: dict[str, Any] = {"summary": [], "facts": [], "meaning": None, "client_explain": None, "qa": [],
                         "caution": None, "checkpoints": []}
    cau: dict[str, Any] = {}
    for s in sentences:
        kind = s["section"].split(":", 1)[1]
        base = {"text": s["text"], "source_ids": s.get("source_ids") or []}
        if kind == "summary":
            c["summary"].append(base)
        elif kind == "fact":
            c["facts"].append({**base, "date": s.get("date", "")})
        elif kind in ("meaning", "client_explain"):
            c[kind] = base
        elif kind == "qa":
            # 2차 검토에서 문장을 고쳤으면 'Q. … A. …'를 다시 나눈다
            m = re.match(r"^\s*Q\.\s*(.+?)\s*A\.\s*(.+)$", s["text"], re.S)
            q, a = (m.group(1), m.group(2)) if m else (s.get("q", ""), s["text"])
            c["qa"].append({"q": q.strip(), "a": a.strip(), "source_ids": base["source_ids"]})
        elif kind.startswith("caution_"):
            cau[kind.split("_", 1)[1]] = base
        elif kind == "checkpoint":
            c["checkpoints"].append({**base, "when": s.get("when", "")})
    if cau.get("what"):
        c["caution"] = cau
    c["facts"].sort(key=lambda f: f.get("date") or "9999")
    return c


async def _digest_ai(claude_key: str, model: str, company: PortfolioCompany, month: str, sources: list[dict],
                     prev_summary: Optional[str]) -> tuple[Optional[llm_client.LLMResult], str, Optional[str]]:
    prompt = DIGEST_PROMPT.format(
        name=company.name, industry=f"({company.industry})" if company.industry else "", label=month_label(month), month=month,
        sources="\n".join(f"[{s['id']}] {s['text']}" for s in sources), prev=prev_summary or "(없음)",
    )
    try:
        return await llm_client.claude_json(claude_key, prompt, model=model, max_tokens=3000), prompt, None
    except llm_client.LLMError as e:
        return None, prompt, str(e)


# --------------------------------------------------------------------------- 4. 전체 실행

async def _get_or_create(db: AsyncSession, month: str) -> MonthlyBriefing:
    mb = (await db.execute(select(MonthlyBriefing).where(MonthlyBriefing.month == month))).scalar_one_or_none()
    if not mb:
        mb = MonthlyBriefing(month=month, status="generating")
        db.add(mb)
        await db.flush()
    return mb


async def _save_digest(db: AsyncSession, company_id: str, month: str, stat: dict, content: Optional[dict],
                       table: dict[str, dict], model: Optional[str]) -> None:
    summary = " ".join(s["text"] for s in (content or {}).get("summary") or []) or None
    fact_ids = sorted({table[sid]["id"] for f in (content or {}).get("facts") or [] for sid in f.get("source_ids") or []
                       if sid in table and table[sid]["type"] in ("fact", "funding")})
    values = dict(summary=summary, content=content, key_fact_ids=fact_ids, article_count=stat.get("total", 0),
                  positive_count=stat.get("positive", 0), caution_count=stat.get("caution", 0), model=model)
    stmt = pg_insert(CompanyMonthlyDigest).values(id=_uuid(), company_id=company_id, month=month, **values)
    stmt = stmt.on_conflict_do_update(constraint="uq_monthly_digest_company_month", set_={**values, "updated_at": func.now()})
    await db.execute(stmt)


def _uuid() -> str:
    import uuid

    return str(uuid.uuid4())


async def build_monthly(db: AsyncSession, month: Optional[str] = None, *, force: bool = False) -> dict:
    """월간 브리핑을 만든다. 배치는 매일 돌고 1일에만 실행(force면 언제든)."""
    today = today_kst()
    if not month:
        if today.day != 1 and not force:
            return {"skipped": "오늘은 1일이 아님"}
        month = target_month_for(today)
    if not MONTH_RE.match(month):
        return {"error": "month는 YYYY-MM 형식"}
    mb = await _get_or_create(db, month)
    if mb.status == "sent" and not force:
        return {"skipped": "이미 발송됨", "id": mb.id}
    if mb.status == "sent":
        return {"skipped": "발송된 월간 브리핑은 다시 만들 수 없습니다", "id": mb.id}
    mb.status, mb.hold_reason = "generating", None
    await db.commit()

    try:
        return await _build(db, mb)
    except Exception as e:  # noqa: BLE001
        logger.exception("월간 브리핑 실패")
        await db.rollback()
        mb = await db.get(MonthlyBriefing, mb.id)
        mb.status, mb.hold_reason = "held", f"작성 중 오류: {e}"[:500]
        await db.commit()
        return {"id": mb.id, "status": "held", "error": str(e)}


async def _build(db: AsyncSession, mb: MonthlyBriefing) -> dict:
    month = mb.month
    companies = list((await db.execute(
        select(PortfolioCompany).where(PortfolioCompany.is_active == True, PortfolioCompany.deleted_at.is_(None))  # noqa: E712
        .order_by(PortfolioCompany.name)
    )).scalars().all())
    by_id = {c.id: c for c in companies}
    stats = await portfolio_stats(db, month, companies)
    stat_by = {r["company_id"]: r for r in stats["companies"]}
    per_company, table = await gather_sources(db, month, companies)
    prev = dict((await db.execute(
        select(CompanyMonthlyDigest.company_id, CompanyMonthlyDigest.summary).where(CompanyMonthlyDigest.month == prev_month(month))
    )).all())

    claude = await get_service_key(db, "claude")
    gemini = await get_service_key(db, "gemini")
    models = await config.get_models(db)
    await release(db)

    if not claude:
        mb.stats, mb.content = stats, {"summary": [], "highlights": [], "companies": [], "cautions": [], "checkpoints": [], "sources": {}}
        mb.status, mb.hold_reason = "held", "Claude 키가 없어 월간 정리를 쓰지 못했습니다(설정 > API 키)."
        mb.review_summary = {}
        await db.commit()
        return {"id": mb.id, "status": mb.status, "reason": mb.hold_reason}

    # 2) 기업별 요약(동시 4개)
    order = [c for c in companies if c.id in per_company]
    sem = asyncio.Semaphore(AI_CONCURRENCY)

    async def one(c: PortfolioCompany):
        async with sem:
            return await _digest_ai(claude[0], models["writer"], c, month, per_company[c.id], prev.get(c.id))

    results = await asyncio.gather(*(one(c) for c in order))
    drafts: dict[str, dict] = {}
    all_sentences: dict[str, list[dict]] = {}
    ai_errors: list[str] = []
    for idx, (c, (res, prompt, err)) in enumerate(zip(order, results), 1):
        if res is not None:
            await cross_review.log_draft(db, "monthly", mb.id, res, models["writer"], prompt)
        if err or res is None or not isinstance(res.data, dict):
            ai_errors.append(f"{c.name}: {err or '응답 형식 오류'}")
            continue
        drafts[c.id] = res.data
        all_sentences[c.id] = digest_sentences(idx, c.id, res.data)

    # 3) 월간 종합(이달의 요약·주목 기업)
    dig_txt = []
    for c in order:
        ss = all_sentences.get(c.id) or []
        if ss:
            dig_txt.append(f"## {c.name} (company_id={c.id})\n" + "\n".join(
                f"- {s['text']} [{', '.join(s['source_ids'])}]" for s in ss if not s["section"].endswith("qa")))
    stat_txt = (f"기사 {stats['article_count']}건(전월 {stats['prev_article_count']}건), 긍정 {stats['positive_count']}·주의 {stats['caution_count']}, "
                f"기사가 있는 기업 {stats['company_with_news']}/{stats['company_total']}곳\n" + "\n".join(
                    f"- {r['name']}: {r['total']}건(주의 {r['caution']}, 전월 {r['prev_total']})" for r in stats["companies"] if r["total"]))
    overall_draft: dict = {}
    if dig_txt:
        p = OVERALL_PROMPT.format(label=month_label(month), month=month, stats=stat_txt, digests="\n\n".join(dig_txt))
        await release(db)
        try:
            r = await llm_client.claude_json(claude[0], p, model=models["writer"], max_tokens=3000)
            await cross_review.log_draft(db, "monthly", mb.id, r, models["writer"], p)
            overall_draft = r.data if isinstance(r.data, dict) else {}
        except llm_client.LLMError as e:
            ai_errors.append(f"월간 종합: {e}")
    o_sentences = overall_sentences(overall_draft)

    # 4) 교차 검토(기업 묶음별 + 종합)
    src_list = {s["id"]: s for lst in per_company.values() for s in lst}
    kept: dict[str, list[dict]] = defaultdict(list)
    kept_overall: list[dict] = []
    removed_all: list[dict] = []
    total_n = removed_n = disputed_n = 0
    review_fail = False
    ids = [cid for cid in all_sentences if all_sentences[cid]]
    chunks = [ids[i:i + REVIEW_CHUNK_COMPANIES] for i in range(0, len(ids), REVIEW_CHUNK_COMPANIES)]
    jobs: list[tuple[list[dict], list[dict]]] = []
    for ch in chunks:
        sens = [s for cid in ch for s in all_sentences[cid]]
        srcs = [s for cid in ch for s in per_company.get(cid, [])]
        jobs.append((sens, srcs))
    if o_sentences:
        cited = {sid for s in o_sentences for sid in s["source_ids"]}
        jobs.append((o_sentences, [src_list[x] for x in sorted(cited) if x in src_list]))
    for sens, srcs in jobs:
        outcome = await cross_review.review_sentences(
            db, sources=srcs, sentences=sens, claude_key=claude[0], gemini_key=gemini[0] if gemini else None,
            models=models, target_type="monthly", target_id=mb.id, mode="briefing",
        )
        review_fail = review_fail or not outcome.review2_ok
        total_n += outcome.summary.get("total", 0)
        removed_n += outcome.summary.get("removed", 0)
        disputed_n += outcome.summary.get("disputed", 0)
        removed_all.extend(outcome.removed)
        for s in outcome.sentences:
            if s["section"].startswith("company:"):
                kept[s["company_id"]].append(s)
            else:
                kept_overall.append(s)

    # 5) 저장
    company_sections = []
    cautions, checkpoints = [], []
    for c in companies:
        st = stat_by.get(c.id, {})
        content = rebuild_company(kept.get(c.id, [])) if c.id in drafts else None
        await _save_digest(db, c.id, month, st, content, table, models["writer"] if content else None)
        if not content or not any([content["summary"], content["facts"], content["client_explain"]]):
            continue
        company_sections.append({"company_id": c.id, "name": c.name, "article_count": st.get("total", 0),
                                 "caution_count": st.get("caution", 0), **content})
        if content["caution"]:
            cautions.append({"company_id": c.id, "name": c.name, **content["caution"]})
        for p in content["checkpoints"]:
            checkpoints.append({"company_id": c.id, "name": c.name, **p})
    company_sections.sort(key=lambda x: (-bool(x["caution"]), -x["article_count"], x["name"]))
    checkpoints.sort(key=lambda x: x.get("when") or "9999")
    summary = [{"text": s["text"], "source_ids": s.get("source_ids") or []} for s in kept_overall if s["section"] == "summary"]
    highlights = [{"company_id": s.get("company_id"), "name": by_id[s["company_id"]].name if s.get("company_id") in by_id else "",
                   "text": s["text"], "source_ids": s.get("source_ids") or []}
                  for s in kept_overall if s["section"] == "highlight"]
    used = {sid for sec in company_sections for k in ("summary", "facts", "qa", "checkpoints") for x in sec[k] for sid in x.get("source_ids", [])}
    used |= {sid for sec in company_sections for k in ("meaning", "client_explain") if sec[k] for sid in sec[k]["source_ids"]}
    used |= {sid for x in summary + highlights for sid in x["source_ids"]}
    used |= {sid for cau in cautions for k in ("what", "impact", "check") if cau.get(k) for sid in cau[k]["source_ids"]}

    ratio = round(removed_n / total_n, 3) if total_n else 0.0
    reasons = []
    if review_fail:
        reasons.append("교차 검토(2차)가 끝나지 않았습니다")
    if ratio > HOLD_RATIO:
        reasons.append(f"검토에서 삭제된 문장이 {ratio * 100:.0f}%로 30%를 넘었습니다")
    if not summary and stats["article_count"]:
        reasons.append("이달의 요약 문장이 남지 않았습니다")
    if ai_errors and len(ai_errors) > max(1, len(order) // 3):
        reasons.append(f"AI 작성 실패 {len(ai_errors)}건")

    mb.stats = stats
    mb.content = {"summary": summary, "highlights": highlights, "companies": company_sections,
                  "cautions": cautions, "checkpoints": checkpoints,
                  "sources": {sid: table[sid] for sid in sorted(used) if sid in table}}
    mb.review_summary = {"total": total_n, "removed": removed_n, "disputed": disputed_n, "removed_ratio": ratio,
                         "review_ok": not review_fail, "ai_errors": ai_errors[:20],
                         "removed_samples": [{"text": r.get("text"), "reason": r.get("reason")} for r in removed_all[:15]]}
    mb.status = "held" if reasons else "ready"
    mb.hold_reason = " / ".join(reasons) or None
    mb.approved_by = mb.approved_at = None
    await index_monthly(db, mb)
    await db.commit()
    return {"id": mb.id, "month": month, "status": mb.status, "reason": mb.hold_reason,
            "companies": len(company_sections), "sentences": total_n, "removed_ratio": ratio}


# --------------------------------------------------------------------------- 검색 색인

async def index_monthly(db: AsyncSession, mb: MonthlyBriefing) -> None:
    c = mb.content or {}
    parts = [x["text"] for x in c.get("summary") or []]
    for sec in c.get("companies") or []:
        parts.append(f"{sec['name']}: " + " ".join(x["text"] for x in sec.get("summary") or []))
    start, _ = month_bounds(mb.month)
    await search.index_entity(db, "monthly", mb.id, title=f"{mb.month} 월간 브리핑", body="\n".join(parts),
                              doc_date=start.date(), tags=[mb.status],
                              url_path=f"{search.BASE}/briefing?month={mb.month}")
    for sec in c.get("companies") or []:
        body = " ".join([x["text"] for x in sec.get("summary") or []] + [x["text"] for x in sec.get("facts") or []]
                        + ([sec["client_explain"]["text"]] if sec.get("client_explain") else []))
        await search.index_entity(db, "digest", f"{sec['company_id']}:{mb.month}", company_id=sec["company_id"],
                                  title=f"{sec['name']} {mb.month} 월간 요약", body=body, doc_date=start.date(),
                                  tags=["digest"], url_path=f"{search.BASE}/companies/{sec['company_id']}?tab=ledger")


# --------------------------------------------------------------------------- 조회·상태 변경

async def set_hold(db: AsyncSession, mb: MonthlyBriefing, hold: bool, user_id: str, reason: Optional[str] = None) -> MonthlyBriefing:
    if mb.status in ("sent", "generating"):
        raise ValueError("발송됐거나 만드는 중인 월간 브리핑은 바꿀 수 없습니다.")
    if hold:
        mb.status, mb.hold_reason = "held", reason or "관리자가 보류했습니다."
        mb.approved_by = mb.approved_at = None
    else:
        mb.status, mb.approved_by, mb.approved_at = "ready", user_id, now_kst()
    await db.commit()
    await db.refresh(mb)
    return mb


async def digests_for(db: AsyncSession, company_id: str, limit: int = 24) -> list[dict]:
    rows = (await db.execute(
        select(CompanyMonthlyDigest).where(CompanyMonthlyDigest.company_id == company_id)
        .order_by(CompanyMonthlyDigest.month.desc()).limit(limit)
    )).scalars().all()
    return [{"month": d.month, "summary": d.summary, "content": d.content, "article_count": d.article_count,
             "positive_count": d.positive_count, "caution_count": d.caution_count,
             "updated_at": d.updated_at.isoformat() if d.updated_at else None} for d in rows]
