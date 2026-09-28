"""투자기업 2단계 삭제.

1단계 · 화면에서 삭제(trash): 목록·검색·기업DB 트리·수집·브리핑에서 빠진다. 기사·원장·폴더 파일은 그대로 남고 [복구] 가능.
2단계 · 폴더까지 완전 삭제(purge): 1단계로 지운 기업만. DB 데이터(기사·키워드·원장·투자유치·공공데이터·백필·파일 목록)는
         FK CASCADE로, 검색 색인·다운로드 기록은 직접 지우고, 기업DB 폴더(저장소의 기업 디렉터리)를 통째로 지운다. 되돌릴 수 없다.
지난 데일리 브리핑 본문 안의 기업 요약은 발송 기록이므로 남긴다.
"""
from __future__ import annotations

import logging
import shutil
from typing import Optional

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.company_report import (
    CompanyFact, CompanyFile, CompanyFileDownload, CompanyFundingRound, CompanyPublicData, SearchIndex,
)
from app.models.news_briefing import BackfillJob, CompanyKeyword, NewsArticle, PortfolioCompany
from app.services.company_report import search, storage
from app.services.company_report.timeutil import now_kst

logger = logging.getLogger(__name__)


class DeleteError(ValueError):
    pass


async def trash(db: AsyncSession, company: PortfolioCompany, user_id: str) -> None:
    if company.deleted_at:
        return
    running = (await db.execute(select(BackfillJob.id).where(
        BackfillJob.company_id == company.id, BackfillJob.status.in_(["queued", "running"])))).first()
    if running:
        raise DeleteError("과거 데이터 구축이 진행 중입니다. 끝난 뒤에 삭제해 주세요.")
    company.deleted_at, company.deleted_by = now_kst(), user_id
    company.is_active = False  # 수집·브리핑·공공데이터 대상에서 제외
    await db.execute(delete(SearchIndex).where(SearchIndex.company_id == company.id))


async def restore(db: AsyncSession, company: PortfolioCompany) -> dict:
    """복구: 활성으로 되돌리고 검색 색인을 다시 만든다."""
    company.deleted_at, company.deleted_by, company.is_active = None, None, True
    await search.index_company(db, company)
    n = 0
    for a in (await db.execute(select(NewsArticle).where(NewsArticle.company_id == company.id, NewsArticle.is_hidden == False,  # noqa: E712
                                                         NewsArticle.is_representative == True))).scalars():  # noqa: E712
        await search.index_article(db, a)
        n += 1
    for f in (await db.execute(select(CompanyFact).where(CompanyFact.company_id == company.id))).scalars():
        await search.index_fact(db, f)
    for r in (await db.execute(select(CompanyFundingRound).where(CompanyFundingRound.company_id == company.id))).scalars():
        await search.index_funding(db, r)
    for f in (await db.execute(select(CompanyFile).where(CompanyFile.company_id == company.id, CompanyFile.status != "deleted"))).scalars():
        await search.index_file(db, f, company.name)
    return {"articles": n}


async def summary(db: AsyncSession, company_id: str) -> dict:
    """완전 삭제 전에 보여줄 '지워질 것' 목록."""
    async def count(model, *cond):
        return (await db.execute(select(func.count()).select_from(model).where(*cond))).scalar_one()

    size = (await db.execute(select(func.coalesce(func.sum(CompanyFile.size), 0)).where(CompanyFile.company_id == company_id))).scalar_one()
    return {
        "articles": await count(NewsArticle, NewsArticle.company_id == company_id),
        "keywords": await count(CompanyKeyword, CompanyKeyword.company_id == company_id),
        "facts": await count(CompanyFact, CompanyFact.company_id == company_id),
        "funding_rounds": await count(CompanyFundingRound, CompanyFundingRound.company_id == company_id),
        "public_data": await count(CompanyPublicData, CompanyPublicData.company_id == company_id),
        "backfill_jobs": await count(BackfillJob, BackfillJob.company_id == company_id),
        "files": await count(CompanyFile, CompanyFile.company_id == company_id),
        "file_bytes": int(size or 0),
    }


def _company_dir(company_id: str):
    base = storage.root().resolve()
    d = (base / company_id).resolve()
    if base not in d.parents or d == base:
        raise DeleteError("잘못된 폴더 경로")
    return d


async def purge(db: AsyncSession, company: PortfolioCompany, confirm_name: str, user_id: Optional[str]) -> dict:
    if not company.deleted_at:
        raise DeleteError("먼저 '화면에서 삭제'(1단계)를 한 기업만 완전 삭제할 수 있습니다.")
    if (confirm_name or "").strip() != company.name:
        raise DeleteError("확인용 기업명이 일치하지 않습니다.")
    stats = await summary(db, company.id)
    cid, name = company.id, company.name
    await db.execute(delete(SearchIndex).where(SearchIndex.company_id == cid))
    await db.execute(delete(CompanyFileDownload).where(CompanyFileDownload.company_id == cid))
    await db.execute(delete(PortfolioCompany).where(PortfolioCompany.id == cid))  # 나머지는 FK CASCADE
    await db.commit()
    removed_dir = False
    try:
        d = _company_dir(cid)
        if d.exists():
            shutil.rmtree(d)
            removed_dir = True
    except Exception as e:  # DB는 이미 지워졌으므로 폴더 실패는 기록만
        logger.warning("기업 폴더 삭제 실패(%s): %s", cid, e)
    logger.warning("투자기업 완전 삭제: %s(%s) by %s — %s", name, cid, user_id, stats)
    return {"name": name, **stats, "folder_removed": removed_dir}
