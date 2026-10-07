"""배치·공용 기능용 API 키 조회.

키는 회사 공용 키(대표가 등록) / 본인 키(Notion) 로 나뉜다 — `collectors/key_access.resolve_key` 참고.
배치(데일리 브리핑 등)는 로그인 사용자가 없으므로 회사 공용 키를 쓴다.
예전엔 공용 키가 없으면 아무 사용자의 활성 키를 썼는데, 매니저 개인 키가 남에게 쓰일 수 있어 막았다(2026-10-07).
네이버 키는 기존 규칙대로 .env(NAVER_CLIENT_ID/SECRET)를 먼저 본다.
"""
from __future__ import annotations

from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.services.collectors.key_access import resolve_key


async def get_service_key(
    db: AsyncSession, provider: str, user_id: Optional[str] = None
) -> Optional[tuple[str, str]]:
    """(api_key, api_secret) 반환. 없으면 None."""
    if provider == "naver_search" and settings.NAVER_CLIENT_ID and settings.NAVER_CLIENT_SECRET:
        return settings.NAVER_CLIENT_ID, settings.NAVER_CLIENT_SECRET
    return await resolve_key(db, provider, user_id)


async def release(db: AsyncSession) -> None:
    """외부 API·AI처럼 오래 걸리는 호출 직전에 DB 연결을 풀에 돌려준다.

    열린 트랜잭션이 있으면 수 분짜리 네트워크 대기 동안 연결을 붙잡아 연결 풀(QueuePool)이 바닥난다.
    지금까지의 변경을 커밋하고 연결을 반납한다(다음 쿼리 때 새로 빌림, expire_on_commit=False라 객체는 그대로).
    """
    if db.in_transaction():
        await db.commit()
