"""Authentication endpoints."""
import logging
from datetime import datetime, timedelta
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import get_db
from app.schemas.auth import Token, LoginRequest, RegisterRequest, PasswordChangeRequest
from app.services.auth import authenticate_user, get_user_by_email, update_password
from app.core.security import IMPERSONATION_TOKEN_EXPIRE_MINUTES, create_access_token, verify_password
from app.core.deps import Auth, CurrentUser, NotImpersonating
from app.core.config import settings
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])


async def _audit_login(db: AsyncSession, request: Request, email: str, user=None, ok: bool = True, via: str = "password") -> None:
    """로그인 성공·실패 감사 기록 (지시서 10.1). 실패 시 시도한 이메일만 남기고 비밀번호는 절대 남기지 않는다."""
    from app.services import audit_service  # noqa: PLC0415

    uid = user.id if (ok and user is not None) else None
    await audit_service.record(
        db, actor_id=uid, effective_id=uid, action="login" if ok else "login_failed",
        resource_type="auth", status_code=200 if ok else 401,
        payload_summary={"email": (email or "")[:255], "via": via}, **audit_service.request_meta(request),
    )


async def _touch_last_login(db: AsyncSession, user) -> None:
    """최근 로그인 시각 기록 (대표 관리 화면 표시용). 실패해도 로그인은 진행."""
    try:
        user.last_login = datetime.utcnow()
        await db.commit()
    except Exception:  # pragma: no cover
        logger.warning("last_login 기록 실패", exc_info=True)
        try:
            await db.rollback()
        except Exception:
            pass


@router.post("/register", status_code=status.HTTP_403_FORBIDDEN, include_in_schema=False)
async def register(user_in: RegisterRequest):
    """공개 가입은 닫혀 있다 (docs/login_logic D-1).

    이 시스템은 내부 전용이다. 계정은 대표가 `POST /api/v1/managers` 로 매니저를 추가해서만 만든다.
    """
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="회원가입은 지원하지 않습니다. 대표에게 매니저 계정 발급을 요청하세요.",
    )


@router.post("/login", response_model=Token)
async def login(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
):
    """Login and get access token."""
    user = await authenticate_user(db, form_data.username, form_data.password)
    if not user or not user.is_active:
        await _audit_login(db, request, form_data.username, ok=False)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    await _touch_last_login(db, user)
    await _audit_login(db, request, form_data.username, user=user)

    access_token = create_access_token(subject=user.id)
    return Token(access_token=access_token)


@router.post("/login/json", response_model=Token)
async def login_json(
    login_data: LoginRequest,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Login with JSON body and get access token."""
    user = await authenticate_user(db, login_data.email, login_data.password)
    if not user or not user.is_active:
        await _audit_login(db, request, login_data.email, ok=False)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        )
    await _touch_last_login(db, user)
    await _audit_login(db, request, login_data.email, user=user)

    access_token = create_access_token(subject=user.id)
    return Token(access_token=access_token)


@router.post("/logout")
async def logout(current_user: CurrentUser):
    """Logout current user.

    Note: For stateless JWT, this endpoint just returns success.
    Implement token blacklist for true logout functionality.
    """
    return {"message": "Successfully logged out"}


@router.post("/password/change", dependencies=[NotImpersonating])
async def change_password(
    password_data: PasswordChangeRequest,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Change current user's password."""
    if not verify_password(password_data.current_password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Incorrect current password"
        )

    await update_password(db, current_user, password_data.new_password)
    return {"message": "Password changed successfully"}


from pydantic import BaseModel

class GoogleLoginRequest(BaseModel):
    credential: str  # Google ID token


@router.post("/google", response_model=Token)
async def google_login(
    data: GoogleLoginRequest,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Login with Google OAuth. Auto-registers if email not found."""
    import httpx

    # Verify Google ID token
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"https://oauth2.googleapis.com/tokeninfo?id_token={data.credential}"
            )
    except Exception as e:
        logger.error(f"Google token verification failed: {e}")
        raise HTTPException(status_code=500, detail=f"Google verification error: {str(e)}")

    if resp.status_code != 200:
        logger.error(f"Google token invalid: {resp.status_code} {resp.text}")
        raise HTTPException(status_code=401, detail="Invalid Google token")

    google_info = resp.json()

    # Verify audience matches our client ID
    if google_info.get("aud") != settings.GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=401, detail="Token audience mismatch")

    email = google_info.get("email")
    if not email:
        raise HTTPException(status_code=400, detail="Email not found in Google token")

    # 등록된 활성 계정만 로그인 (자동 가입 없음 — docs/login_logic D-1)
    user = await get_user_by_email(db, email)
    if not user or not user.is_active:
        logger.info(f"Google login rejected (no active account): {email}")
        await _audit_login(db, request, email, ok=False, via="google")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="등록되지 않은 계정입니다. 대표에게 매니저 계정 발급을 요청하세요.",
        )
    await _touch_last_login(db, user)
    await _audit_login(db, request, email, user=user, via="google")

    access_token = create_access_token(subject=user.id)
    return Token(access_token=access_token)


# ---------------------------------------------------------------------------
# 대행 로그인 (docs/login_logic P3, 지시서 7장)
#   - 대표 토큰으로 매니저 계정 전환 토큰을 받는다 (비밀번호 공유 없음)
#   - 토큰: sub=매니저, act=대표, imp=true, 2시간
#   - 시작·종료는 감사 로그에 actor·effective 함께 기록
#   ※ /impersonate/exit 를 /impersonate/{user_id} 보다 먼저 등록해야 경로가 겹치지 않는다
# ---------------------------------------------------------------------------

from app.core.permissions import is_valid_impersonation, require_owner  # noqa: E402
from app.schemas.user import UserResponse  # noqa: E402
from app.services import audit_service  # noqa: E402


def _user_out(u) -> dict:
    return UserResponse.model_validate(u).model_dump(mode="json")


def _exp_iso(exp) -> str | None:
    if not exp:
        return None
    return datetime.utcfromtimestamp(int(exp)).isoformat() + "Z"


@router.get("/session")
async def get_session(ctx: Auth):
    """실제 행위자·실효 사용자·대행 여부 (프론트 배너·메뉴 분기의 단일 소스)."""
    return {
        "actor": _user_out(ctx.actor),
        "effective": _user_out(ctx.effective),
        "is_impersonating": ctx.is_impersonating,
        "impersonation_expires_at": _exp_iso(ctx.token_exp) if ctx.is_impersonating else None,
    }


@router.post("/impersonate/exit")
async def exit_impersonation(ctx: Auth, request: Request, db: Annotated[AsyncSession, Depends(get_db)]):
    """대행 종료 → 대표 본인의 일반 토큰 재발급."""
    if not ctx.is_impersonating:
        raise HTTPException(status_code=400, detail="대행 로그인 중이 아닙니다.")
    await audit_service.record(
        db, actor_id=ctx.actor.id, effective_id=ctx.effective.id, action="impersonate_end",
        resource_type="users", resource_id=ctx.effective.id, status_code=200,
        payload_summary={"target": ctx.effective.nickname}, **audit_service.request_meta(request),
    )
    return Token(access_token=create_access_token(subject=ctx.actor.id))


@router.post("/impersonate/{user_id}")
async def start_impersonation(
    user_id: str, ctx: Auth, request: Request, db: Annotated[AsyncSession, Depends(get_db)],
):
    """대표 → 매니저 계정 전환 토큰 발급."""
    if ctx.is_impersonating:
        # 중첩 대행 금지 (지시서 7.2 → 400)
        raise HTTPException(status_code=400, detail="이미 대행 중입니다. 내 계정으로 돌아간 뒤 전환하세요.")
    require_owner(ctx.actor)
    from sqlalchemy import select  # noqa: PLC0415

    target = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if target is None:
        raise HTTPException(status_code=404, detail="대상을 찾을 수 없습니다.")
    if not is_valid_impersonation(ctx.actor, target):
        raise HTTPException(status_code=400, detail="활성 매니저 계정으로만 전환할 수 있습니다.")

    token = create_access_token(
        subject=target.id,
        expires_delta=timedelta(minutes=IMPERSONATION_TOKEN_EXPIRE_MINUTES),
        extra_claims={"act": ctx.actor.id, "imp": True},
    )
    await audit_service.record(
        db, actor_id=ctx.actor.id, effective_id=target.id, action="impersonate_start",
        resource_type="users", resource_id=target.id, status_code=200,
        payload_summary={"target": target.nickname}, **audit_service.request_meta(request),
    )
    return {
        "access_token": token,
        "token_type": "bearer",
        "impersonating": {"user_id": target.id, "nickname": target.nickname, "email": target.email},
        "expires_in": IMPERSONATION_TOKEN_EXPIRE_MINUTES * 60,
    }
