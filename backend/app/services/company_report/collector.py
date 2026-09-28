"""뉴스·공시 수집 (기획 3장 F2·F3, 9장 데일리 ①②, 7-5 기본 백필).

- 네이버: 필수어별 최신순, 직전 수집 이후만(검색어당 최근 1,000건 한도 → hit_limit 기록)
- DART: corp_code가 있으면 기간 공시
- 정제: URL 정규화 중복 제거, 제외어·관련도 규칙, 제목 유사 기사 묶기(대표 1건)
"""
from __future__ import annotations

import logging
import uuid
from collections import Counter
from datetime import date, datetime, timedelta
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.news_briefing import BackfillJob, CompanyKeyword, NewsArticle, PortfolioCompany
from app.services.collectors import naver_news_client as naver
from app.services.collectors.dart_client import DARTClient, dart_disclosure_url
from app.services.company_report.dedup import group_similar, relevance, url_hash
from app.services.company_report.keys import get_service_key
from app.services.company_report.timeutil import now_kst, today_kst

logger = logging.getLogger(__name__)


async def _keywords(db: AsyncSession, company_id: str) -> dict[str, list[str]]:
    rows = (await db.execute(select(CompanyKeyword).where(CompanyKeyword.company_id == company_id))).scalars().all()
    out: dict[str, list[str]] = {"required": [], "boost": [], "exclude": []}
    for r in rows:
        out.setdefault(r.kind, []).append(r.keyword)
    return out


async def _existing_hashes(db: AsyncSession, company_id: str) -> set[str]:
    rows = (await db.execute(select(NewsArticle.url_hash).where(NewsArticle.company_id == company_id))).all()
    return {r[0] for r in rows}


def _queries(kw: dict[str, list[str]], combos: bool) -> list[str]:
    qs = list(dict.fromkeys(kw["required"]))
    if combos:
        # 1,000건 한도를 넘기 위한 조합 검색(필수어 × 보조어)
        for rq in kw["required"][:2]:
            for b in kw["boost"][:4]:
                qs.append(f"{rq} {b}")
    return qs


async def _fetch_naver(db: AsyncSession, kw: dict, since: Optional[datetime], combos: bool,
                       max_items: int = 1000) -> tuple[list[dict], list[str]]:
    key = await get_service_key(db, "naver_search")
    if not key:
        logger.warning("네이버 검색 키가 없어 뉴스 수집을 건너뜁니다.")
        return [], []
    items: list[dict] = []
    hit_limit: list[str] = []
    for q in _queries(kw, combos):
        try:
            res = await naver.search_since(key[0], key[1], q, since, max_items=max_items)
        except Exception as e:
            logger.info("네이버 수집 실패(%s): %s", q, e)
            continue
        if res["hit_limit"]:
            hit_limit.append(q)
        for it in res["items"]:
            it["source"] = "naver"
            items.append(it)
    return items, hit_limit


async def _fetch_dart(db: AsyncSession, company: PortfolioCompany, since: date, until: date) -> list[dict]:
    if not company.corp_code:
        return []
    key = await get_service_key(db, "dart")
    if not key:
        return []
    try:
        rows = await DARTClient(key[0]).list_disclosures(company.corp_code, since.strftime("%Y%m%d"), until.strftime("%Y%m%d"))
    except Exception as e:
        logger.info("DART 공시 수집 실패: %s", e)
        return []
    out = []
    for r in rows:
        d = r.get("rcept_dt") or ""
        pub = datetime.strptime(d, "%Y%m%d") if len(d) == 8 else None
        out.append({
            "title": f"[공시] {r.get('report_nm', '').strip()}",
            "url": dart_disclosure_url(r.get("rcept_no", "")),
            "description": f"제출인: {r.get('flr_nm', '')}",
            "published_at": pub,
            "press": "DART",
            "source": "dart",
            "source_type": "dart",
        })
    return out


async def _store(db: AsyncSession, company_id: str, items: list[dict], kw: dict, via: str) -> dict:
    """정제 후 새 기사만 저장. 반환 통계."""
    known = await _existing_hashes(db, company_id)
    fresh: list[dict] = []
    excluded = 0
    for it in items:
        h = url_hash(it["url"]) if it.get("url") else None
        if not h or h in known:
            continue
        known.add(h)
        if it.get("source_type") == "dart":
            score = 100
        else:
            rel = relevance(it["title"], it.get("description", ""), kw["required"], kw["boost"], kw["exclude"])
            if rel.excluded:
                excluded += 1
                continue
            score = rel.score
        it["_hash"], it["_score"] = h, score
        fresh.append(it)

    fresh.sort(key=lambda x: x.get("published_at") or datetime.min)
    for group in group_similar(fresh):
        gid = str(uuid.uuid4()) if len(group) > 1 else None
        for rank, idx in enumerate(group):
            it = fresh[idx]
            db.add(NewsArticle(
                company_id=company_id,
                source_type=it.get("source_type", "news"),
                source=it.get("source", "naver"),
                collected_via=via,
                url=it["url"],
                url_hash=it["_hash"],
                title=it["title"][:1000],
                description=it.get("description"),
                press=(it.get("press") or "")[:100] or None,
                published_at=it.get("published_at"),
                relevance_score=it["_score"],
                dup_group_id=gid,
                is_representative=(rank == 0),  # 가장 이른 기사가 대표
            ))
    return {"new": len(fresh), "excluded": excluded}


async def collect_company(db: AsyncSession, company_id: str, via: str = "daily",
                          since: Optional[datetime] = None) -> dict:
    """한 기업의 새 기사·공시를 모은다(데일리·수동 수집)."""
    company = await db.get(PortfolioCompany, company_id)
    if not company or not company.is_active:
        return {"new": 0, "skipped": True}
    kw = await _keywords(db, company_id)
    if not kw["required"]:
        kw["required"] = [company.name]
    now = now_kst()
    since = since or company.last_collected_at or (now - timedelta(days=7))
    news, hit = await _fetch_naver(db, kw, since, combos=False, max_items=300)
    dart = await _fetch_dart(db, company, (since - timedelta(days=1)).date(), now.date())
    stats = await _store(db, company_id, news + dart, kw, via)
    company.last_collected_at = now
    await db.commit()
    stats["hit_limit"] = hit
    return stats


async def collect_all(db: AsyncSession, via: str = "daily") -> dict:
    ids = (await db.execute(select(PortfolioCompany.id).where(PortfolioCompany.is_active == True))).scalars().all()  # noqa: E712
    total = Counter()
    for cid in ids:
        try:
            s = await collect_company(db, cid, via=via)
            total["new"] += s.get("new", 0)
            total["excluded"] += s.get("excluded", 0)
        except Exception as e:
            logger.exception("수집 실패(%s): %s", cid, e)
            await db.rollback()
            total["failed"] += 1
    total["companies"] = len(ids)
    return dict(total)


async def basic_backfill(db: AsyncSession, company_id: str, months: int = 6,
                         user_id: Optional[str] = None, trigger: str = "register") -> dict:
    """기본 백필(1단계): 네이버 조합 검색 + DART 기간 공시. 검증 ①~⑥은 2단계(P2-11·12)."""
    company = await db.get(PortfolioCompany, company_id)
    if not company:
        return {}
    today = today_kst()
    start = today - timedelta(days=30 * months)
    job = BackfillJob(company_id=company_id, period_from=start, period_to=today, trigger=trigger,
                      status="running", created_by=user_id)
    db.add(job)
    await db.commit()
    try:
        kw = await _keywords(db, company_id)
        if not kw["required"]:
            kw["required"] = [company.name]
        news, hit = await _fetch_naver(db, kw, datetime.combine(start, datetime.min.time()), combos=True)
        job.progress = 50
        dart = await _fetch_dart(db, company, start, today)
        stats = await _store(db, company_id, news + dart, kw, via="backfill")
        await db.flush()
        # 월별 분포(기간 커버리지 ①의 기초 자료)
        rows = (await db.execute(
            select(NewsArticle.published_at).where(
                NewsArticle.company_id == company_id, NewsArticle.is_hidden == False,  # noqa: E712
                NewsArticle.published_at >= datetime.combine(start, datetime.min.time()),
            )
        )).all()
        monthly = Counter(r[0].strftime("%Y-%m") for r in rows if r[0])
        job.source_stats = {"naver": sum(1 for n in news), "dart": len(dart), "new": stats["new"], "excluded": stats["excluded"]}
        job.coverage = {"monthly": dict(sorted(monthly.items())), "hit_limit_queries": hit}
        job.status, job.progress, job.finished_at = "done", 100, now_kst()
        company.last_collected_at = now_kst()
        await db.commit()
        # 백필한 기사 요약(대표 기사만)
        from app.services.company_report import summarizer

        await summarizer.summarize_pending(db, company_id=company_id, limit=400)
        return {"job_id": job.id, **stats}
    except Exception as e:
        logger.exception("기본 백필 실패: %s", e)
        await db.rollback()
        job = await db.get(BackfillJob, job.id)
        if job:
            job.status, job.error, job.finished_at = "failed", str(e)[:1000], now_kst()
            await db.commit()
        return {"error": str(e)}
