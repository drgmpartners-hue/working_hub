"""사용자 API 키 조회·복호화 헬퍼.

user_api_keys 테이블에서 provider별 키를 읽어 복호화한다.
복호화는 user_api_keys 라우터의 Fernet(_decrypt)을 재사용.
"""
from __future__ import annotations

from typing import Optional

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user_api_key import UserApiKey
from app.api.v1.user_api_keys import _decrypt


async def get_user_key(
    db: AsyncSession,
    user_id: str,
    provider: str,
) -> Optional[tuple[str, str]]:
    """provider의 (api_key, api_secret) 복호화 반환. 없거나 비활성이면 None.

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
    key = result.scalar_one_or_none()
    if not key:
        return None
    try:
        api_key = _decrypt(key.api_key)
        api_secret = _decrypt(key.api_secret) if key.api_secret else ""
    except Exception:
        return None
    return api_key, api_secret
