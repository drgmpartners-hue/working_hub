"""API 키 조회·복호화 — 회사 공용 키 / 본인 키 (2026-10-07 결정).

- 대부분의 외부 API 키(Claude·Gemini·KIS·DART·네이버·공공데이터·KIPRIS)는 **회사 공용 키**다.
  대표(role=owner)가 설정 > API 관리에 등록한 키를 매니저도 함께 쓴다. 매니저는 따로 넣지 않는다.
- **본인 키**(PERSONAL_PROVIDERS, 지금은 Notion)는 사용자마다 자기 것만 쓴다.
  다른 회사 사람이 매니저로 들어와도 우리 회사 Notion 에 연결되지 않게 하기 위함.
- 예전에는 공용 키가 없으면 '활성 키 중 아무 사용자 것'을 썼다 → 매니저 개인 키가 남에게 쓰일 수 있어 막았다.
"""
from __future__ import annotations

from typing import Optional

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.user_api_keys import _decrypt
from app.models.user_api_key import UserApiKey

PERSONAL_PROVIDERS = frozenset({"notion"})
# 키 하나만 쓰는 서비스 — 두 번째 칸(api_secret)은 쓰지 않는다. 예전에 잘못 들어간 값이 남아 있으면
# 그 값이 안 열려도 키 전체를 못 쓰게 되던 문제가 있어(대표 Gemini 키, 2026-10-07) 아예 읽지 않는다.
SINGLE_FIELD_PROVIDERS = frozenset({"claude", "gemini", "notion", "dart", "data_go_kr", "kipris"})


def uses_secret(provider: str) -> bool:
    return provider not in SINGLE_FIELD_PROVIDERS


def is_personal(provider: str) -> bool:
    return provider in PERSONAL_PROVIDERS


async def get_user_key(
    db: AsyncSession,
    user_id: str,
    provider: str,
) -> Optional[tuple[str, str]]:
    """그 사용자 본인이 등록한 (api_key, api_secret). 없거나 비활성·복호화 실패면 None.

    api_secret이 없는 provider(dart 등)는 빈 문자열로 반환.
    """
    result = await db.execute(
        select(UserApiKey).where(
            and_(
                UserApiKey.user_id == user_id,
                UserApiKey.provider == provider,
                UserApiKey.is_active == True,  # noqa: E712
            )
        )
    )
    key = result.scalars().first()
    if not key:
        return None
    try:
        api_key = _decrypt(key.api_key)
        api_secret = _decrypt(key.api_secret) if (key.api_secret and uses_secret(provider)) else ""
    except Exception:
        return None
    return api_key, api_secret


async def company_key_owner_ids(db: AsyncSession, provider: str) -> list[str]:
    """이 provider 의 회사 공용 키를 가진 대표 계정들(최근 수정 순)."""
    from app.models.user import User

    rows = (
        await db.execute(
            select(UserApiKey.user_id)
            .join(User, User.id == UserApiKey.user_id)
            .where(
                UserApiKey.provider == provider,
                UserApiKey.is_active == True,  # noqa: E712
                User.role == "owner",
                User.is_active == True,  # noqa: E712
            )
            .order_by(UserApiKey.updated_at.desc())
        )
    ).all()
    return [uid for (uid,) in rows]


async def get_company_key(db: AsyncSession, provider: str) -> Optional[tuple[str, str]]:
    """대표가 등록한 회사 공용 키. 본인 키 provider(Notion)는 공용으로 쓰지 않는다."""
    if is_personal(provider):
        return None
    for uid in await company_key_owner_ids(db, provider):
        found = await get_user_key(db, uid, provider)
        if found:
            return found
    return None


async def resolve_key(
    db: AsyncSession, provider: str, user_id: Optional[str] = None
) -> Optional[tuple[str, str]]:
    """기능이 실제로 쓸 키.
    - 본인 키 provider: 그 사용자 것만 (사용자 없으면 None)
    - 그 밖: 회사 공용 키 (대표 본인이 부르면 자기 키를 먼저)
    """
    if is_personal(provider):
        return await get_user_key(db, user_id, provider) if user_id else None
    if user_id:
        from app.models.user import User

        u = await db.get(User, user_id)
        if u is not None and u.role == "owner":
            own = await get_user_key(db, user_id, provider)
            if own:
                return own
    return await get_company_key(db, provider)
