"""기업DB 자동 파일 작업자 — 웹 백엔드(Volume이 붙은 서비스) 안에서만 돈다.

Railway Volume은 한 서비스에만 붙는다. Cron 서비스는 파일을 쓰지 않고 app_settings에
'files_dirty_at'만 남기고, 웹 서비스의 이 루프가 30분마다 확인해 파일을 만든다.
- 표시가 있거나 마지막 갱신 후 12시간이 지나면: 활성 기업 자동 파일 갱신
- 발송된 데일리 브리핑 중 PDF가 없는 것(최근 30일)은 '_포트폴리오 공통'에 저장
"""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timedelta

from sqlalchemy import select

logger = logging.getLogger(__name__)

DIRTY_KEY = "company_db_files_dirty_at"
LAST_KEY = "company_db_files_refreshed_at"
INTERVAL = 30 * 60
MAX_AGE = timedelta(hours=12)


async def mark_dirty(db) -> None:
    from app.services import settings_store
    from app.services.company_report.timeutil import now_kst

    await settings_store.set_value(db, DIRTY_KEY, now_kst().isoformat(timespec="seconds"))


def _parse(v):
    try:
        return datetime.fromisoformat(v) if v else None
    except ValueError:
        return None


async def run_once(force: bool = False) -> dict:
    from app.db.session import AsyncSessionLocal
    from app.models.company_report import CompanyFile
    from app.models.news_briefing import NewsBriefing, PortfolioCompany
    from app.services import settings_store
    from app.services.company_report import company_db
    from app.services.company_report.timeutil import now_kst, today_kst

    async with AsyncSessionLocal() as db:
        dirty = _parse(await settings_store.get(db, DIRTY_KEY))
        last = _parse(await settings_store.get(db, LAST_KEY))
        now = now_kst()
        due = force or last is None or (dirty and dirty > last) or (now - last) > MAX_AGE
        out = {"companies": 0, "briefing_pdfs": 0, "ran": bool(due)}
        if due:
            ids = (await db.execute(select(PortfolioCompany.id).where(PortfolioCompany.is_active == True))).scalars().all()  # noqa: E712
            for cid in ids:
                try:
                    await company_db.refresh_auto_files(db, cid)
                    out["companies"] += 1
                except Exception as e:
                    await db.rollback()
                    logger.warning("자동 파일 갱신 실패(%s): %s", cid, e)
            await settings_store.set_value(db, LAST_KEY, now.isoformat(timespec="seconds"))
        # 발송된 브리핑 PDF 보충
        since = today_kst() - timedelta(days=30)
        sent = (await db.execute(select(NewsBriefing).where(NewsBriefing.status == "sent", NewsBriefing.briefing_date >= since))).scalars().all()
        have = set((await db.execute(select(CompanyFile.related_id).where(CompanyFile.related_type == "daily",
                                                                          CompanyFile.status != "deleted"))).scalars().all())
        for b in sent:
            if b.id not in have:
                try:
                    await company_db.save_briefing_pdf(db, b)
                    await db.commit()
                    out["briefing_pdfs"] += 1
                except Exception as e:
                    await db.rollback()
                    logger.warning("브리핑 PDF 저장 실패(%s): %s", b.briefing_date, e)
        # 자료함: 업로드 직후 읽기를 놓친 문서(재시작 등) 다시 처리
        try:
            from app.services.company_report import documents

            out["documents"] = await documents.process_pending(db)
        except Exception as e:
            await db.rollback()
            logger.warning("자료함 처리 실패: %s", e)
        return out


async def loop() -> None:
    await asyncio.sleep(60)  # 기동 직후 마이그레이션·요청 처리 먼저
    while True:
        try:
            from app.db.session import AsyncSessionLocal
            from app.services.company_report import usage

            async with AsyncSessionLocal() as db:
                await usage.flush(db)
            r = await run_once()
            if r.get("ran") or r.get("briefing_pdfs"):
                logger.info("기업DB 자동 파일: %s", r)
        except Exception:
            logger.exception("기업DB 파일 작업자 오류")
        await asyncio.sleep(INTERVAL)


def enabled() -> bool:
    """웹 서비스에서만 켠다. Cron 컨테이너(스크립트)는 이 모듈의 loop를 부르지 않는다. 끄려면 COMPANY_DB_WORKER=0."""
    return os.environ.get("COMPANY_DB_WORKER", "1") != "0"
