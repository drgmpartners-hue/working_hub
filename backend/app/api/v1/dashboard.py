"""내 고객 관리 대시보드 API (수정_tasks P2-8) — 매니저는 본인 담당 고객, 대표는 전체(또는 manager_id)."""
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.db.session import get_db
from app.services import dashboard_service

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/summary")
async def dashboard_summary(manager_id: Optional[str] = Query(None), current_user=Depends(get_current_user),
                            db: AsyncSession = Depends(get_db)):
    return await dashboard_service.summary(db, current_user, manager_id)
