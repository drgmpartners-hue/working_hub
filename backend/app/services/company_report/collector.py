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

from app.models.news_briefing import CompanyKeyword, NewsArticle, PortfolioCompany
from app.services.collectors import naver_news_client as naver
from app.services.collectors.dart_client import DARTClient, dart_disclosure_url
from app.services.company_report import search
from app.services.company_report.dedup import group_similar, relevance, title_similarity, url_hash
from app.services.company_report.keys import get_service_key, release
from app.services.company_report.timeutil import now_kst

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
            await release(db)
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
        await release(db)
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


async def _existing_near(db: AsyncSession, company_id: str, items: list[dict]) -> list[NewsArticle]:
    dates = [it["published_at"] for it in items if it.get("published_at")]
    if not dates:
        return []
    lo, hi = min(dates) - timedelta(days=2), max(dates) + timedelta(days=2)
    return list((await db.execute(select(NewsArticle).where(
        NewsArticle.company_id == company_id, NewsArticle.published_at >= lo, NewsArticle.published_at <= hi,
        NewsArticle.is_representative == True,  # noqa: E712
    ))).scalars().all())


def match_existing(it: dict, existing: list[NewsArticle], threshold: float = 0.55) -> Optional[NewsArticle]:
    """다른 출처(네이버·구글)에서 온 같은 기사: 날짜 ±2일, 제목 유사도 0.55 이상."""
    pub = it.get("published_at")
    best, best_sim = None, 0.0
    for e in existing:
        if pub and e.published_at and abs((e.published_at - pub).total_seconds()) > 2 * 86400:
            continue
        sim = title_similarity(e.title, it["title"])
        if sim >= threshold and sim > best_sim:
            best, best_sim = e, sim
    return best


async def _store(db: AsyncSession, company_id: str, items: list[dict], kw: dict, via: str) -> dict:
    """정제 후 새 기사만 저장. URL 중복·제외어·관련도, 이미 있는 같은 기사(다른 출처)는 묶음에 붙인다."""
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

    existing = await _existing_near(db, company_id, fresh)
    attach: list[tuple[dict, NewsArticle]] = []
    rest: list[dict] = []
    for it in fresh:
        e = match_existing(it, existing) if it.get("source_type") != "dart" else None
        (attach.append((it, e)) if e else rest.append(it))

    def _article(it: dict, gid: Optional[str], rep: bool) -> NewsArticle:
        return NewsArticle(
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
            is_representative=rep,
        )

    created: list[NewsArticle] = []
    for it, e in attach:
        if not e.dup_group_id:
            e.dup_group_id = e.id
        a = _article(it, e.dup_group_id, False)
        db.add(a)
        created.append(a)
    rest.sort(key=lambda x: x.get("published_at") or datetime.min)
    for group in group_similar(rest):
        gid = str(uuid.uuid4()) if len(group) > 1 else None
        for rank, idx in enumerate(group):
            a = _article(rest[idx], gid, rank == 0)  # 가장 이른 기사가 대표
            db.add(a)
            created.append(a)
    if created:
        await db.flush()
        for art in created:
            if art.is_representative:
                await search.index_article(db, art)
    return {"new": len(fresh), "excluded": excluded, "attached": len(attach),
            "representative": sum(1 for a in created if a.is_representative)}


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
