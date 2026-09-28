"""기사 아카이브 — 달력 집계·기간 요약(P2-1·2).

기간 요약은 그 기간의 요약된 대표 기사만 근거로 쓴다. 같은 기사 묶음이면 캐시(company_period_summaries)를 돌려준다.
"""
from __future__ import annotations

import hashlib
import logging
from datetime import date, datetime, timedelta
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.company_report import CompanyPeriodSummary
from app.models.news_briefing import NewsArticle, PortfolioCompany
from app.services import llm_client
from app.services.company_report import config
from app.services.company_report.keys import get_service_key

logger = logging.getLogger(__name__)
MAX_ARTICLES = 120

PERIOD_PROMPT = """너는 벤처캐피탈 직원을 위한 기업 동향 정리 담당이다. 대상: {name}, 기간: {date_from} ~ {date_to}
아래 기사 요약만 근거로 정리하라. 기사에 없는 사실·숫자·전망은 쓰지 마라. 쉬운 말, 두괄식.

기사(A번호는 출처 번호):
{articles}

출력 JSON:
{{"overview": "기간 전체 흐름 3~5문장",
  "key_events": [{{"date": "YYYY-MM-DD", "text": "한 줄", "source_ids": ["A1"]}}],
  "cautions": [{{"text": "주의할 점 한 줄", "source_ids": ["A3"]}}],
  "stats_comment": "기사량·논조 변화 한 문장"}}"""


def month_range(month: str) -> tuple[date, date]:
    y, m = (int(x) for x in month.split("-"))
    start = date(y, m, 1)
    end = (date(y + (m == 12), m % 12 + 1, 1)) - timedelta(days=1)
    return start, end


async def article_dates(db: AsyncSession, company_id: str, month: str) -> list[dict]:
    start, end = month_range(month)
    day = func.date(NewsArticle.published_at)
    rows = (await db.execute(
        select(day, func.count(), func.count().filter(NewsArticle.tag == "caution"))
        .where(NewsArticle.company_id == company_id, NewsArticle.is_hidden == False,  # noqa: E712
               NewsArticle.is_representative == True,  # noqa: E712
               NewsArticle.published_at >= datetime.combine(start, datetime.min.time()),
               NewsArticle.published_at < datetime.combine(end + timedelta(days=1), datetime.min.time()))
        .group_by(day).order_by(day)
    )).all()
    return [{"date": (d.isoformat() if hasattr(d, "isoformat") else str(d)), "count": n, "caution": c} for d, n, c in rows]


async def _articles(db: AsyncSession, company_id: str, date_from: date, date_to: date) -> list[NewsArticle]:
    return list((await db.execute(
        select(NewsArticle).where(
            NewsArticle.company_id == company_id, NewsArticle.is_hidden == False,  # noqa: E712
            NewsArticle.is_representative == True,  # noqa: E712
            NewsArticle.published_at >= datetime.combine(date_from, datetime.min.time()),
            NewsArticle.published_at < datetime.combine(date_to + timedelta(days=1), datetime.min.time()),
        ).order_by(NewsArticle.published_at)
    )).scalars().all())


def article_hash(arts: list[NewsArticle]) -> str:
    return hashlib.sha256("|".join(f"{a.id}:{a.tag}" for a in arts).encode()).hexdigest()


async def period_summary(db: AsyncSession, company_id: str, date_from: date, date_to: date,
                         user_id: Optional[str] = None, refresh: bool = False) -> dict:
    company = await db.get(PortfolioCompany, company_id)
    if not company:
        raise ValueError("기업 없음")
    arts = await _articles(db, company_id, date_from, date_to)
    stats = {"articles": len(arts), "caution": sum(1 for a in arts if a.tag == "caution"),
             "positive": sum(1 for a in arts if a.tag == "positive")}
    if not arts:
        return {"cached": False, "stats": stats, "content": {"overview": "이 기간에 수집된 기사가 없습니다.", "key_events": [], "cautions": []}, "sources": []}
    h = article_hash(arts)
    if not refresh:
        hit = (await db.execute(select(CompanyPeriodSummary).where(
            CompanyPeriodSummary.company_id == company_id, CompanyPeriodSummary.date_from == date_from,
            CompanyPeriodSummary.date_to == date_to, CompanyPeriodSummary.article_hash == h,
        ).order_by(CompanyPeriodSummary.created_at.desc()).limit(1))).scalars().first()
        if hit:
            return {"cached": True, "stats": stats, **(hit.content or {})}

    key = await get_service_key(db, "claude")
    if not key:
        raise llm_client.LLMError("Claude 키가 없습니다")
    models = await config.get_models(db)
    use = sorted(arts, key=lambda a: (a.tag != "caution", -(a.relevance_score or 0)))[:MAX_ARTICLES]
    use.sort(key=lambda a: a.published_at or datetime.min)
    sources = [{"id": f"A{i}", "article_id": a.id, "title": a.title, "url": a.url,
                "date": a.published_at.date().isoformat() if a.published_at else None}
               for i, a in enumerate(use, 1)]
    txt = "\n".join(f"[A{i}] ({(a.published_at.date().isoformat() if a.published_at else '-')}, {a.tag or '-'}) {a.title} — {a.summary or ''}"
                    for i, a in enumerate(use, 1))
    r = await llm_client.claude_json(key[0], PERIOD_PROMPT.format(name=company.name, date_from=date_from, date_to=date_to, articles=txt),
                                     model=models["summary"], max_tokens=2500)
    content = r.data if isinstance(r.data, dict) else {}
    valid = {s["id"] for s in sources}
    for k in ("key_events", "cautions"):  # 근거 없는 항목 제거
        content[k] = [x for x in (content.get(k) or []) if isinstance(x, dict) and set(x.get("source_ids") or []) & valid]
    payload = {"content": content, "sources": sources}
    db.add(CompanyPeriodSummary(company_id=company_id, date_from=date_from, date_to=date_to, article_hash=h,
                                content=payload, model=r.model, created_by=user_id))
    await db.commit()
    return {"cached": False, "stats": stats, **payload}
