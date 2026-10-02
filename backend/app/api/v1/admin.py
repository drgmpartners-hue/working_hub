"""대표 전용 통합 현황 API (docs/login_logic P4-3, 결정 D-3)."""
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import Auth
from app.core.permissions import require_owner
from app.db.session import get_db
from app.services import admin_service

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/overview")
async def get_overview(ctx: Auth, db: AsyncSession = Depends(get_db)):
    """전체 합계 + 매니저별 고객·계좌·업무 자료 수 + 최근 활동(감사 로그)."""
    require_owner(ctx.effective)
    return await admin_service.overview(db)


@router.get("/audit-logs")
async def list_audit_logs(
    ctx: Auth,
    db: AsyncSession = Depends(get_db),
    date_from: Optional[date] = Query(None, description="시작일(포함)"),
    date_to: Optional[date] = Query(None, description="종료일(포함)"),
    user_id: Optional[str] = Query(None, description="실제 행위자 또는 권한 계정이 이 사람인 기록"),
    client_id: Optional[str] = Query(None),
    action: Optional[str] = Query(None),
    impersonated: Optional[bool] = Query(None, description="true=대행 기록만, false=본인 기록만"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """감사 로그 조회 — 대표 전용 (결정 D-5: 매니저는 본인 기록도 볼 수 없다).

    대행 중(권한 계정이 매니저)에는 403.
    """
    require_owner(ctx.effective)
    return await admin_service.audit_logs(
        db,
        date_from=date_from,
        date_to=date_to,
        user_id=user_id,
        client_id=client_id,
        action=action,
        impersonated=impersonated,
        limit=limit,
        offset=offset,
    )


@router.get("/security-status")
async def security_status(ctx: Auth, db: AsyncSession = Depends(get_db)):
    """보안 설정 점검(수정_tasks P2-1): 암호화 전용 키·다시 암호화 결과. 키 값 자체는 절대 내보내지 않는다."""
    import json

    from app.core import encryption
    from app.core.config import settings
    from app.services import settings_store

    require_owner(ctx.effective)
    fatal, warn = encryption.startup_problems()
    raw = await settings_store.get(db, encryption.ROTATION_KEY)
    try:
        rotation = json.loads(raw) if raw else None
    except ValueError:
        rotation = None
    done = bool(settings.ENCRYPTION_KEY) and (await settings_store.get(db, encryption.FP_KEY)) == encryption.fingerprint()
    return {
        "encryption_key_set": bool(settings.ENCRYPTION_KEY),
        "rotation_done": done,
        "rotation": rotation,
        "problems": fatal + warn,
        "ok": bool(settings.ENCRYPTION_KEY) and done and not fatal and not warn
              and not (rotation or {}).get("unreadable"),
    }
