"""매니저 계정 관리 API — 대표 전용 (docs/login_logic P4-1, 지시서 8.1 / 결정 D-1).

공개 가입이 닫혀 있으므로 계정은 이 API 로만 만든다.
- 초기·재설정 비밀번호는 응답에 한 번만 보여 주고 평문을 저장하지 않는다 (지시서 15장).
- 전 라우트: 대표만(require_owner), 쓰기는 대행 중 금지(forbid_while_impersonating).
"""
import secrets
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import Auth
from app.core.permissions import MANAGER, forbid_while_impersonating, is_owner, require_owner
from app.core import programs
from app.core.security import get_password_hash
from app.db.session import get_db
from app.models.client import Client
from app.models.user import User
from app.services import admin_service, transfer_service

router = APIRouter(prefix="/managers", tags=["managers"])


class ManagerCreate(BaseModel):
    email: EmailStr
    nickname: str = Field(..., min_length=1, max_length=50)
    phone: Optional[str] = Field(None, max_length=20)
    # 사용 프로그램 (docs/login_logic P11): 대표가 열어 준 것만. 키는 app/core/programs.py
    allowed_programs: list[str] = []


class ManagerUpdate(BaseModel):
    # 로그인 아이디(이메일) 변경 — 예: 네이버 메일로 만든 계정을 지메일로 바꿔 구글 로그인을 쓰게 할 때
    email: Optional[EmailStr] = None
    nickname: Optional[str] = Field(None, min_length=1, max_length=50)
    phone: Optional[str] = Field(None, max_length=20)
    is_active: Optional[bool] = None
    allowed_programs: Optional[list[str]] = None  # null 을 보내면 '전부 허용'


def _temp_password() -> str:
    """임시 비밀번호 (12자). 응답에 1회만 노출."""
    return secrets.token_urlsafe(9)


async def _get_user_or_404(db: AsyncSession, user_id: str) -> User:
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="계정을 찾을 수 없습니다.")
    return user


@router.get("/programs")
async def list_programs(ctx: Auth):
    """고를 수 있는 프로그램 목록(관리 화면 체크박스용)."""
    require_owner(ctx.effective)
    return [{"key": k, "label": n, "group": g} for k, n, g in programs.PROGRAMS]


@router.get("")
async def list_managers(ctx: Auth, db: AsyncSession = Depends(get_db)):
    """전체 계정(대표 포함) + 담당 고객·계좌·업무 자료 수 + 최근 로그인."""
    require_owner(ctx.effective)
    return await admin_service.list_users_with_stats(db)


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_manager(body: ManagerCreate, ctx: Auth, db: AsyncSession = Depends(get_db)):
    require_owner(ctx.effective)
    forbid_while_impersonating(ctx)
    email = body.email.lower().strip()
    exists = (await db.execute(select(User.id).where(func.lower(User.email) == email))).scalar_one_or_none()
    if exists:
        raise HTTPException(status_code=409, detail="이미 등록된 이메일입니다.")
    temp = _temp_password()
    user = User(
        email=email,
        hashed_password=get_password_hash(temp),
        nickname=body.nickname.strip(),
        phone=(body.phone or "").strip() or None,
        is_active=True,
        role=MANAGER,
        created_by_user_id=ctx.actor.id,
        allowed_programs=programs.normalize(body.allowed_programs),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return {**admin_service.user_brief(user), "temp_password": temp}


@router.patch("/{user_id}")
async def update_manager(user_id: str, body: ManagerUpdate, ctx: Auth, db: AsyncSession = Depends(get_db)):
    require_owner(ctx.effective)
    forbid_while_impersonating(ctx)
    user = await _get_user_or_404(db, user_id)
    data = body.model_dump(exclude_unset=True)

    if "is_active" in data and data["is_active"] != user.is_active:
        if data["is_active"] is False:
            if user.id == ctx.actor.id:
                raise HTTPException(status_code=400, detail="본인 계정은 비활성화할 수 없습니다.")
            if is_owner(user):
                raise HTTPException(status_code=400, detail="대표 계정은 여기서 비활성화할 수 없습니다.")
            # 퇴사 절차: 담당 고객을 먼저 이관해야 비활성화 가능 (지시서 9.4)
            remaining = int(
                (await db.execute(select(func.count()).select_from(Client).where(Client.user_id == user.id))).scalar_one()
            )
            if remaining:
                raise HTTPException(
                    status_code=409,
                    detail=f"담당 고객이 {remaining}명 남아 있습니다. 다른 매니저에게 이관한 뒤 비활성화하세요.",
                )
            user.is_active = False
            user.deactivated_at = datetime.utcnow()
        else:
            user.is_active = True
            user.deactivated_at = None

    if data.get("email"):
        new_email = str(data["email"]).lower().strip()
        if new_email != (user.email or "").lower():
            if is_owner(user):
                raise HTTPException(status_code=400, detail="대표 계정의 이메일은 여기서 바꿀 수 없습니다.")
            dup = (await db.execute(
                select(User.id).where(func.lower(User.email) == new_email, User.id != user.id)
            )).scalar_one_or_none()
            if dup:
                raise HTTPException(status_code=409, detail="이미 다른 계정이 쓰는 이메일입니다.")
            user.email = new_email

    if "nickname" in data and data["nickname"]:
        user.nickname = data["nickname"].strip()
    if "phone" in data:
        user.phone = (data["phone"] or "").strip() or None
    if "allowed_programs" in data:
        if is_owner(user):
            raise HTTPException(status_code=400, detail="대표 계정은 모든 프로그램을 씁니다.")
        user.allowed_programs = programs.normalize(data["allowed_programs"])

    await db.commit()
    await db.refresh(user)
    return admin_service.user_brief(user)


@router.post("/{user_id}/reset-password")
async def reset_manager_password(user_id: str, ctx: Auth, db: AsyncSession = Depends(get_db)):
    """임시 비밀번호 발급. 평문은 이 응답에 한 번만 보이고 저장하지 않는다."""
    require_owner(ctx.effective)
    forbid_while_impersonating(ctx)
    user = await _get_user_or_404(db, user_id)
    if user.id == ctx.actor.id:
        raise HTTPException(status_code=400, detail="본인 비밀번호는 [프로필 > 비밀번호 변경]에서 바꾸세요.")
    if is_owner(user):
        raise HTTPException(status_code=400, detail="대표 계정의 비밀번호는 여기서 바꿀 수 없습니다.")
    temp = _temp_password()
    user.hashed_password = get_password_hash(temp)
    await db.commit()
    return {"id": user.id, "email": user.email, "temp_password": temp}


@router.get("/{user_id}/summary")
async def manager_summary(user_id: str, ctx: Auth, db: AsyncSession = Depends(get_db)):
    """한 매니저의 담당 고객 전체 + 수당 정산·콘텐츠·분석·문자 최근 항목."""
    require_owner(ctx.effective)
    user = await _get_user_or_404(db, user_id)
    return await admin_service.manager_summary(db, user)


class TransferAllRequest(BaseModel):
    to_user_id: str
    reason: Optional[str] = Field(None, max_length=300)


@router.post("/{user_id}/transfer-all")
async def transfer_all_clients(
    user_id: str, body: TransferAllRequest, ctx: Auth, request: Request, db: AsyncSession = Depends(get_db),
):
    """한 매니저의 전 고객을 다른 계정으로 일괄 이관 (퇴사 처리 1단계, 지시서 9.4)."""
    require_owner(ctx.effective)
    forbid_while_impersonating(ctx)
    from_user = await _get_user_or_404(db, user_id)
    target = await transfer_service.validate_target(db, body.to_user_id)
    moved = await transfer_service.transfer_all(db, from_user, target, ctx.actor.id, body.reason)
    request.state.audit = {
        "action": "transfer_all",
        "resource_type": "managers",
        "resource_id": user_id,
        "summary": {"from": user_id, "to": target.id, "count": moved, "reason": body.reason},
    }
    return {"moved": moved, "from_user_id": user_id, "to_user_id": target.id}
