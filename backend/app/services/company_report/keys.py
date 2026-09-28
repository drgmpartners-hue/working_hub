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


async def release(db: AsyncSession) -> None:
    """외부 API·AI처럼 오래 걸리는 호출 직전에 DB 연결을 풀에 돌려준다.

    열린 트랜잭션이 있으면 수 분짜리 네트워크 대기 동안 연결을 붙잡아 연결 풀(QueuePool)이 바닥난다.
    지금까지의 변경을 커밋하고 연결을 반납한다(다음 쿼리 때 새로 빌림, expire_on_commit=False라 객체는 그대로).
    """
    if db.in_transaction():
        await db.commit()
