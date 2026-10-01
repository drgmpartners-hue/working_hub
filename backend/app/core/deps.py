"""Dependencies for authentication.

권한체계(docs/login_logic):
- AuthContext.actor     : 실제로 로그인한 주체 (대행 중이면 대표)
- AuthContext.effective : 권한 판정에 쓰이는 계정 (대행 중이면 매니저)
- get_current_user / CurrentUser 는 기존 이름·타입 그대로 "실효 사용자(effective)"를 돌려준다.
  → 기존 라우트는 수정 없이 동작하고, 대행 여부가 필요한 소수 라우트만 Auth 를 주입받는다.
"""
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from jose import jwt, JWTError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.db.session import get_db
from app.models.user import User
from app.core.config import settings
from app.core.security import ALGORITHM

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")


@dataclass
class AuthContext:
    actor: User  # 실제 로그인 주체 (대행 중이면 대표)
    effective: User  # 권한이 적용되는 계정 (대행 중이면 매니저)
    token_exp: int | None = None  # 토큰 만료 시각(epoch 초) — 대행 배너 남은 시간 표시용

    @property
    def is_impersonating(self) -> bool:
        return self.actor.id != self.effective.id


def _credentials_exception() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )


async def _load_active_user(db: AsyncSession, user_id: str) -> User:
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise _credentials_exception()
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Inactive user")
    return user


async def get_auth_context(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    token: Annotated[str, Depends(oauth2_scheme)],
) -> AuthContext:
    """JWT 에서 실효 사용자(sub)와 실제 행위자(act)를 분리해 읽는다."""
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise _credentials_exception()

    effective_id = payload.get("sub")
    if not effective_id:
        raise _credentials_exception()
    actor_id = payload.get("act") or effective_id  # act 없으면 본인

    effective_user = await _load_active_user(db, effective_id)
    if actor_id == effective_id:
        actor_user = effective_user
    else:
        actor_user = await _load_active_user(db, actor_id)
        # 대행 토큰의 유효성은 발급 시점이 아니라 매 요청마다 다시 확인한다.
        # (대표가 강등됐거나 대상이 매니저가 아니게 되면 즉시 무효)
        from app.core.permissions import is_valid_impersonation

        if not is_valid_impersonation(actor_user, effective_user):
            raise _credentials_exception()

    ctx = AuthContext(actor=actor_user, effective=effective_user, token_exp=payload.get("exp"))
    # 매니저별 사용 프로그램 (docs/login_logic P11): 열지 않은 프로그램 전용 API 는 403. 대행 중이면 대상 매니저 기준
    from app.core.programs import check_path

    check_path(effective_user, getattr(getattr(request, "url", None), "path", "") or "")
    # 감사 로그 미들웨어가 읽을 수 있도록 요청 상태에 남긴다.
    try:
        request.state.auth_ctx = ctx
    except Exception:  # pragma: no cover - 테스트용 가짜 Request 대비
        pass
    return ctx


async def get_current_user(
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
) -> User:
    """기존 시그니처 유지 — 실효 사용자를 반환한다."""
    return ctx.effective


CurrentUser = Annotated[User, Depends(get_current_user)]
Auth = Annotated[AuthContext, Depends(get_auth_context)]


async def forbid_impersonation(
    request: Request,
    _user: Annotated[User, Depends(get_current_user)],
) -> None:
    """대행 로그인 중 금지 동작에 거는 의존성 (지시서 7.3).

    판정은 permissions.forbid_while_impersonating 이 한다. get_current_user 를 거치므로
    get_auth_context 가 남긴 request.state.auth_ctx 를 읽는다.
    """
    from app.core.permissions import forbid_while_impersonating

    ctx = getattr(request.state, "auth_ctx", None)
    if ctx is not None:
        forbid_while_impersonating(ctx)


NotImpersonating = Depends(forbid_impersonation)
