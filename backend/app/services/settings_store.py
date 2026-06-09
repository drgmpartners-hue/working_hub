"""앱 전역 설정 (key-value) 읽기/쓰기 헬퍼."""
from __future__ import annotations

from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.app_setting import AppSetting

# 설정 키
REPORT_EMAIL_ENABLED = "report_email_enabled"   # "1"/"0"
REPORT_EMAIL_RECIPIENT = "report_email_recipient"


async def get(db: AsyncSession, key: str, default: Optional[str] = None) -> Optional[str]:
    row = await db.get(AppSetting, key)
    return row.value if row and row.value is not None else default


async def set_value(db: AsyncSession, key: str, value: str) -> None:
    row = await db.get(AppSetting, key)
    if row:
        row.value = value
    else:
        db.add(AppSetting(key=key, value=value))
    await db.commit()


async def get_bool(db: AsyncSession, key: str, default: bool = False) -> bool:
    v = await get(db, key)
    if v is None:
        return default
    return v == "1"
