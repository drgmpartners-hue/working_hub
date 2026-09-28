"""배치·공용 기능용 API 키 조회.

`user_api_keys`는 사용자별 키다. 배치(데일리 브리핑 등)는 로그인 사용자가 없으므로
관리자(is_superuser) 계정의 키를 먼저, 없으면 활성 키 중 가장 최근 것을 쓴다.
네이버 키는 기존 규칙대로 .env(NAVER_CLIENT_ID/SECRET)를 먼저 본다.
"""
from __future__ import annotations

from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.user import User
from app.models.user_api_key import UserApiKey
from app.services.collectors.key_access import get_user_key


async def get_service_key(
    db: AsyncSession, provider: str, user_id: Optional[str] = None
) -> Optional[tuple[str, str]]:
    """(api_key, api_secret) 반환. 없으면 None."""
    if provider == "naver_search" and settings.NAVER_CLIENT_ID and settings.NAVER_CLIENT_SECRET:
        return settings.NAVER_CLIENT_ID, settings.NAVER_CLIENT_SECRET

    if user_id:
        found = await get_user_key(db, user_id, provider)
        if found:
            return found

    rows = (
        await db.execute(
            select(UserApiKey.user_id, User.is_superuser)
            .join(User, User.id == UserApiKey.user_id)
            .where(UserApiKey.provider == provider, UserApiKey.is_active == True)  # noqa: E712
            .order_by(User.is_superuser.desc(), UserApiKey.updated_at.desc())
        )
    ).all()
    for uid, _ in rows:
        found = await get_user_key(db, uid, provider)
        if found:
            return found
    return None
