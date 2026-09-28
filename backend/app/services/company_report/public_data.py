"""공공데이터 월 1회 스냅샷(P2-8) — company_public_data.

- nps: 국민연금 가입자 수(임직원 수 추이)·월 고지액·취득/상실
- nts: 국세청 사업자 상태(계속·휴업·폐업) — 휴·폐업이면 주의 사실 후보로 올린다
- kipris: 특허·실용신안 출원/등록 수와 최근 목록 (월 1,000회 무료 한도 보호)
- kis: 상장사 현재가·시총(키가 있을 때)
"""
from __future__ import annotations

import logging
import re
from datetime import date
from typing import Optional

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.company_report import CompanyFact, CompanyPublicData
from app.models.news_briefing import PortfolioCompany
from app.services import settings_store
from app.services.collectors import public_data_clients as pdc
from app.services.company_report import search
from app.services.company_report.keys import get_service_key, release
from app.services.company_report.timeutil import today_kst

logger = logging.getLogger(__name__)

SOURCES = ["nps", "nts", "kipris", "kis"]
KIPRIS_MONTHLY_CAP = 900  # 무료 1,000회 중 여유분


async def _save(db: AsyncSession, company_id: str, source: str, as_of: date, data: Optional[dict], error: Optional[str]) -> None:
    stmt = pg_insert(CompanyPublicData).values(id=_uuid(), company_id=company_id, source=source, as_of=as_of, data=data, error=error)
    stmt = stmt.on_conflict_do_update(constraint="uq_public_data_snapshot", set_={"data": stmt.excluded.data, "error": stmt.excluded.error})
    await db.execute(stmt)


def _uuid() -> str:
    import uuid

    return str(uuid.uuid4())


async def _kipris_budget(db: AsyncSession, need: int) -> bool:
    k = f"kipris_calls_{today_kst().strftime('%Y%m')}"
    used = int(await settings_store.get(db, k, "0") or 0)
    return used + need <= KIPRIS_MONTHLY_CAP


async def _kipris_add(db: AsyncSession, calls: int) -> None:
    k = f"kipris_calls_{today_kst().strftime('%Y%m')}"
    used = int(await settings_store.get(db, k, "0") or 0)
    await settings_store.set_value(db, k, str(used + calls))


async def _nts_flag(db: AsyncSession, company: PortfolioCompany, status: dict) -> None:
    """휴·폐업이면 법적·상태 사실 후보(주의)로 올린다(같은 상태는 한 번만)."""
    code = status.get("b_stt_cd")
    if code not in ("02", "03"):
        return
    title = f"국세청 사업자 상태: {status.get('b_stt')}" + (f"({status.get('end_dt')})" if status.get("end_dt") else "")
    exists = (await db.execute(select(CompanyFact.id).where(CompanyFact.company_id == company.id, CompanyFact.title == title))).first()
    if exists:
        return
    f = CompanyFact(company_id=company.id, fact_type="legal", fact_date=today_kst(), title=title,
                    detail={"출처": "국세청 사업자등록 상태조회", "상태코드": code}, source_refs=[], status="candidate", origin="ai")
    db.add(f)
    await db.flush()
    await search.index_fact(db, f)


async def snapshot_company(db: AsyncSession, company: PortfolioCompany, sources: Optional[list[str]] = None,
                           nts_cache: Optional[dict] = None) -> dict:
    sources = sources or SOURCES
    as_of = today_kst()
    out: dict[str, str] = {}
    dg = await get_service_key(db, "data_go_kr")

    if "nps" in sources:
        if not dg:
            out["nps"] = "no_key"
        else:
            try:
                await release(db)
                await _save(db, company.id, "nps", as_of, await pdc.nps_snapshot(dg[0], company.name, company.biz_reg_no), None)
                out["nps"] = "ok"
            except Exception as e:
                await _save(db, company.id, "nps", as_of, None, str(e)[:500])
                out["nps"] = "error"

    if "nts" in sources:
        if not company.biz_reg_no:
            out["nts"] = "no_biz_reg_no"
        elif not dg:
            out["nts"] = "no_key"
        else:
            try:
                await release(db)
                res = nts_cache if nts_cache is not None else await pdc.nts_status(dg[0], [company.biz_reg_no])
                st = res.get(pdc.digits(company.biz_reg_no))
                await _save(db, company.id, "nts", as_of, st or {"b_stt": "조회 결과 없음"}, None)
                if st:
                    await _nts_flag(db, company, st)
                out["nts"] = "ok"
            except Exception as e:
                await _save(db, company.id, "nts", as_of, None, str(e)[:500])
                out["nts"] = "error"

    if "kipris" in sources:
        kp = await get_service_key(db, "kipris")
        if not kp:
            out["kipris"] = "no_key"
        elif not await _kipris_budget(db, 2):
            out["kipris"] = "monthly_cap"
        else:
            try:
                name = re.sub(r"\(주\)|㈜|주식회사", "", company.name).strip()
                await release(db)
                r = await pdc.kipris_patents(kp[0], name)
                await _kipris_add(db, r["calls"])
                await _save(db, company.id, "kipris", as_of, pdc.summarize_patents(r["items"], company.name, as_of.isoformat()), None)
                out["kipris"] = "ok"
            except Exception as e:
                await _save(db, company.id, "kipris", as_of, None, str(e)[:500])
                out["kipris"] = "error"

    if "kis" in sources and company.is_listed and company.stock_code:
        kis = await get_service_key(db, "kis")
        if kis:
            try:
                from app.services.collectors.kis_client import KISClient

                await release(db)
                await _save(db, company.id, "kis", as_of, await KISClient(*kis).get_price_info(company.stock_code), None)
                out["kis"] = "ok"
            except Exception as e:
                await _save(db, company.id, "kis", as_of, None, str(e)[:500])
                out["kis"] = "error"
    await db.commit()
    return out


async def snapshot_due(db: AsyncSession, force: bool = False) -> dict:
    """이번 달 스냅샷이 없는 활성 기업만(매일 배치에서 불러도 월 1회로 끝남)."""
    month_start = today_kst().replace(day=1)
    companies = (await db.execute(select(PortfolioCompany).where(PortfolioCompany.is_active == True))).scalars().all()  # noqa: E712
    done = set()
    if not force:
        done = set((await db.execute(select(CompanyPublicData.company_id).where(
            CompanyPublicData.as_of >= month_start, CompanyPublicData.source == "nps"))).scalars().all())
    targets = [c for c in companies if c.id not in done]
    nts_cache = None
    dg = await get_service_key(db, "data_go_kr")
    if dg and targets:
        try:
            await release(db)
            nts_cache = await pdc.nts_status(dg[0], [c.biz_reg_no for c in targets if c.biz_reg_no])
        except Exception as e:
            logger.warning("국세청 일괄 조회 실패: %s", e)
    stats: dict[str, int] = {}
    for c in targets:
        r = await snapshot_company(db, c, nts_cache=nts_cache)
        for k, v in r.items():
            stats[f"{k}:{v}"] = stats.get(f"{k}:{v}", 0) + 1
    return {"companies": len(targets), **stats}


async def company_public_data(db: AsyncSession, company_id: str) -> dict:
    rows = (await db.execute(select(CompanyPublicData).where(CompanyPublicData.company_id == company_id)
                             .order_by(CompanyPublicData.as_of))).scalars().all()
    latest: dict[str, dict] = {}
    nps_trend = []
    for r in rows:
        latest[r.source] = {"as_of": r.as_of.isoformat(), "data": r.data, "error": r.error}
        if r.source == "nps" and r.data and r.data.get("found"):
            nps_trend.append({"as_of": r.as_of.isoformat(), "data_month": r.data.get("data_month"), "members": r.data.get("members")})
    return {"latest": latest, "nps_trend": nps_trend}
