"""반기 보고서 만들기 전 자료 점검·보완 (2026-10-08).

점검: 대상 기간(반기)의 하루하루가 '매일 수집'(기업 등록일부터) 또는 '과거 데이터 구축'(끝난 작업의 기간)으로
덮였는지, 끝난 달마다 월간 요약이 있는지 본다.
보완: 덮이지 않은 구간을 과거 데이터 구축으로 모으고(기업당 10~30분), 빠진 달의 월간 요약을 만든다.
- 담당자 [보고서 만들기]: 빈 곳이 있으면 화면이 알려 주고 [보완 수집 후 만들기]를 고를 수 있다.
- 1/31·7/31 자동 작성: 항상 보완부터 한다(report_jobs.run_queued).
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import Optional

from sqlalchemy import func, literal_column, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.company_report import CompanyMonthlyDigest
from app.models.news_briefing import BackfillJob, NewsArticle, PortfolioCompany
from app.services.company_report.half_year import half_months, half_range, period_text
from app.services.company_report.timeutil import today_kst

logger = logging.getLogger(__name__)


def _month_range(month: str) -> tuple[date, date]:
    y, m = int(month[:4]), int(month[5:7])
    start = date(y, m, 1)
    nxt = date(y + (m == 12), m % 12 + 1, 1)
    return start, nxt - timedelta(days=1)


def uncovered_days(start: date, end: date, spans: list[tuple[date, date]]) -> list[date]:
    """start~end 중 어느 구간에도 들지 않는 날(순수)."""
    out, d = [], start
    while d <= end:
        if not any(a <= d <= b for a, b in spans):
            out.append(d)
        d += timedelta(days=1)
    return out


async def coverage(db: AsyncSession, company: PortfolioCompany, year: int, half: int,
                   today: Optional[date] = None) -> dict:
    today = today or today_kst()
    start, end = half_range(year, half)
    last = min(end, today)
    spans: list[tuple[date, date]] = []
    if company.created_at:
        spans.append((company.created_at.date(), today))  # 매일 수집은 등록한 날부터
    jobs = (await db.execute(select(BackfillJob).where(BackfillJob.company_id == company.id))).scalars().all()
    spans += [(j.period_from, j.period_to) for j in jobs if j.status == "done"]
    running = any(j.status in ("queued", "running") for j in jobs)
    gaps = uncovered_days(start, last, spans) if start <= last else []

    months = [m for m in half_months(year, half) if _month_range(m)[0] <= last]
    have = set((await db.execute(select(CompanyMonthlyDigest.month).where(
        CompanyMonthlyDigest.company_id == company.id, CompanyMonthlyDigest.month.in_(months)))).scalars().all())
    s_dt = datetime.combine(start, datetime.min.time())
    e_dt = datetime.combine(last + timedelta(days=1), datetime.min.time())
    ym = func.to_char(NewsArticle.published_at, literal_column("'YYYY-MM'"))  # 같은 식을 SELECT·GROUP BY 에 그대로
    counts = dict((await db.execute(
        select(ym, func.count())
        .where(NewsArticle.company_id == company.id, NewsArticle.is_hidden == False,  # noqa: E712
               NewsArticle.published_at >= s_dt, NewsArticle.published_at < e_dt)
        .group_by(ym))).all())
    gap_set = set(gaps)
    rows, missing_months, missing_digests = [], [], []
    for m in months:
        ms, me = _month_range(m)
        me = min(me, last)
        collected = not any(ms <= g <= me for g in gap_set)
        ended = _month_range(m)[1] < today
        digest = m in have
        if not collected:
            missing_months.append(m)
        if ended and not digest:
            missing_digests.append(m)
        rows.append({"month": m, "collected": collected, "digest": digest, "month_ended": ended,
                     "articles": int(counts.get(m, 0))})
    return {
        "period": period_text(year, half), "months": rows,
        "gap_from": gaps[0].isoformat() if gaps else None, "gap_to": gaps[-1].isoformat() if gaps else None,
        "missing_months": missing_months, "missing_digests": missing_digests, "backfill_running": running,
        "ok": not gaps and not missing_digests,
    }


async def fill(db: AsyncSession, company: PortfolioCompany, year: int, half: int, user_id: Optional[str] = None) -> dict:
    """빈 구간 과거 데이터 구축 → 빠진 달 월간 요약. 실패해도 예외를 내지 않고 결과만 돌려준다."""
    from app.services.company_report import backfill, monthly

    out: dict = {"backfill": None, "digests": None, "errors": []}
    cov = await coverage(db, company, year, half)
    if cov["gap_from"]:
        try:
            r = await backfill.run_backfill(db, company.id, date_from=date.fromisoformat(cov["gap_from"]),
                                            date_to=date.fromisoformat(cov["gap_to"]), trigger="report",
                                            user_id=user_id, with_ai_checks=False)
            out["backfill"] = {"from": cov["gap_from"], "to": cov["gap_to"], "verdict": r.get("verdict")}
            if r.get("error"):
                out["errors"].append(f"과거 데이터 구축 실패: {r['error']}")
        except Exception as e:  # 보완이 실패해도 보고서는 있는 자료로 쓴다
            logger.warning("보고서 전 보완 수집 실패(%s): %s", company.name, e)
            out["errors"].append(f"과거 데이터 구축 실패: {e}")
    cov = await coverage(db, company, year, half)
    if cov["missing_digests"]:
        try:
            out["digests"] = await monthly.build_company_digests(db, company, cov["missing_digests"])
        except Exception as e:
            logger.warning("월간 요약 보완 실패(%s): %s", company.name, e)
            out["errors"].append(f"월간 요약 보완 실패: {e}")
    return out
