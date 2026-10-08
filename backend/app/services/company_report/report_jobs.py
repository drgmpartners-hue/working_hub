"""반기 보고서 자동 작업 (P4-11).

- half-year (Cron 1/31·7/31 02:00 KST): 끝난 반기의 보고서를 '예약'만 한다. Cron 서비스에는 파일 저장소(Volume)가
  없어 그림·차트를 저장할 수 없으므로, 실제 작성은 웹 서비스의 file_worker 가 30분마다 몇 건씩 집어 간다.
  - 대상: 활성 기업 중 누군가 목록에 둔 기업. 이미 그 반기 공용본(작성 중·검토 중·완료)이 있으면 건너뛴다.
- run_queued (웹 서비스): 예약된 것을 한 번에 MAX_PER_TICK 건씩 작성. 2시간 넘게 '작성 중'에 멈춘 것은 실패로 바꾼다.
- report-reminders (매주 월 09:00 KST): 대표가 지정한 검토 담당에게만, 아직 공식본(검토 담당의 검토 완료)이 없는
  기업을 모아 1통(2026-10-08). 검토 담당을 정하지 않은 기업은 알리지 않는다. 발송 꺼짐이면 보내지 않는다.
"""
from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.company_report import CompanyReport
from app.models.news_briefing import CompanyMember, PortfolioCompany

logger = logging.getLogger(__name__)

QUEUED = "예약"
MAX_PER_TICK = 3
STALE = timedelta(hours=4)  # 보고서 전 보완 수집(10~30분, 앞 작업 대기 포함)까지 감안


async def queue_half_year(db: AsyncSession, year: Optional[int] = None, half: Optional[int] = None,
                          today: Optional[date] = None) -> dict:
    from app.services.company_report import half_year

    if year is None:
        year, half = half_year.latest_closed_half(today)
    has_member = select(CompanyMember.company_id)
    cids = (await db.execute(select(PortfolioCompany.id).where(
        PortfolioCompany.is_active == True, PortfolioCompany.deleted_at.is_(None),  # noqa: E712
        PortfolioCompany.id.in_(has_member)).order_by(PortfolioCompany.name))).scalars().all()
    have = set((await db.execute(select(CompanyReport.company_id).where(
        CompanyReport.period_year == year, CompanyReport.period_half == half, CompanyReport.owner_user_id.is_(None),
        CompanyReport.status.in_(("generating", "draft", "final"))))).scalars().all())
    queued = []
    for cid in cids:
        if cid in have:
            continue
        r = await half_year.create_report(db, cid, year, half, None)
        r.progress_step = QUEUED
        await db.commit()
        queued.append(r.id)
    return {"year": year, "half": half, "companies": len(cids), "queued": len(queued), "skipped": len(cids) - len(queued)}


async def run_queued(db: AsyncSession, limit: int = MAX_PER_TICK) -> dict:
    """웹 서비스용: 멈춘 것 정리 + 예약된 보고서 몇 건 작성."""
    from app.services.company_report import half_year

    stale = (await db.execute(select(CompanyReport).where(
        CompanyReport.status == "generating", CompanyReport.progress_step != QUEUED,
        CompanyReport.updated_at < func.now() - STALE))).scalars().all()  # updated_at 은 DB 시계
    for r in stale:
        r.status, r.error = "failed", "작성이 중간에 멈췄습니다(서버 재시작 등). 다시 만들어 주세요."
    if stale:
        await db.commit()
    ids = (await db.execute(select(CompanyReport.id).where(
        CompanyReport.status == "generating", CompanyReport.progress_step == QUEUED)
        .order_by(CompanyReport.created_at).limit(limit))).scalars().all()
    done = 0
    for rid in ids:
        r = await db.get(CompanyReport, rid)
        if r is None or r.progress_step != QUEUED:
            continue
        r.progress_step = "대기"  # 집어 감 표시(다음 tick 이 또 집지 않게)
        await db.commit()
        try:
            await half_year.run_report(db, rid, prepare=True)  # 자동 작성은 항상 빈 구간 보완부터(2026-10-08)
            done += 1
        except Exception as e:
            await db.rollback()
            logger.warning("예약 보고서 작성 실패(%s): %s", rid, e)
    return {"stale_failed": len(stale), "ran": done, "picked": len(ids)}


async def pending_review(db: AsyncSession, year: int, half: int) -> dict[str, dict]:
    """{user_id: {name, phone, companies:[이름]}} — 내가 검토 담당인 기업 중, 그 반기 보고서가 나왔는데
    아직 공식본(검토 담당의 검토 완료)이 없는 곳. 검토 담당을 정하지 않은 기업은 빠진다."""
    from app.models.user import User
    from app.services.company_report import report_hub

    rows = (await db.execute(
        select(User.id, User.nickname, User.phone, PortfolioCompany.id, PortfolioCompany.name)
        .join(CompanyMember, CompanyMember.user_id == User.id)
        .join(PortfolioCompany, PortfolioCompany.id == CompanyMember.company_id)
        .where(CompanyMember.is_reviewer == True, User.is_active == True,  # noqa: E712
               PortfolioCompany.is_active == True, PortfolioCompany.deleted_at.is_(None))  # noqa: E712
        .order_by(User.nickname, PortfolioCompany.name))).all()
    by_c = await report_hub.reports_for(db, list({r[3] for r in rows}), year, half)
    out: dict[str, dict] = {}
    for uid, name, phone, cid, cname in rows:
        rs = by_c.get(cid, [])
        ready = any(r.status in report_hub.READY and r.content for r in rs)
        if not phone or not ready or any(report_hub.is_official(r) for r in rs):
            continue
        out.setdefault(uid, {"name": name, "phone": phone, "companies": []})["companies"].append(cname)
    return out


def reminder_text(name: str, companies: list[str], period: str) -> str:
    shown = ", ".join(companies[:8]) + (f" 외 {len(companies) - 8}곳" if len(companies) > 8 else "")
    return (f"[Working Hub] {name}님, 검토 담당으로 지정된 {period} 반기 보고서 중 아직 [검토 완료]하지 않은 기업이 "
            f"{len(companies)}곳 있습니다.\n{shown}\n\n기업 리포트 > 보고서 관리에서 확인 후 검토 완료해 주세요. "
            "검토 완료하면 그 기업을 맡은 모든 담당자가 고객에게 보낼 수 있습니다.")


async def remind(db: AsyncSession, *, dry_run: bool = False, today: Optional[date] = None) -> dict:
    from app.services import settings_store, solapi_service
    from app.services.company_report import config, half_year

    year, half = half_year.latest_closed_half(today)
    period = half_year.half_label(year, half)
    pend = await pending_review(db, year, half)
    msgs = [{"to": t["phone"], "text": reminder_text(t["name"], t["companies"], period),
             "subject": f"[Working Hub] {period} 보고서 검토"} for t in pend.values()]
    if dry_run or not msgs:
        return {"sent": 0, "targets": len(msgs), "dry_run": dry_run, "preview": msgs[:1]}
    if not await settings_store.get_bool(db, config.BRIEFING_ENABLED, default=False):
        return {"sent": 0, "targets": len(msgs), "skipped": "발송 꺼짐"}
    res = await solapi_service.send_many_alimtalk(db, msgs)
    return {"sent": len(msgs) if res.get("success") else 0, "targets": len(msgs),
            "error": None if res.get("success") else res.get("error")}
