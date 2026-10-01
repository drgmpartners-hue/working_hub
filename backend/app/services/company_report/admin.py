"""기업 리포트 관리자(승인·발송 설정·완전 삭제 권한).

관리자 = 대표(role=owner)·users.is_superuser 이거나 app_settings 'company_report_admin_ids'(JSON 목록)에 있는 사용자.
아직 기업 리포트 관리자가 한 명도 없고 대표 계정도 없을 때만, 로그인한 사용자가 [내 계정을 관리자로 지정]으로 처음 관리자가 된다.
그 뒤에는 관리자만 다른 사용자를 추가·해제할 수 있다.
"""
from __future__ import annotations

import json

from sqlalchemy.ext.asyncio import AsyncSession

from app.services import settings_store

KEY = "company_report_admin_ids"


async def admin_ids(db: AsyncSession) -> list[str]:
    try:
        v = json.loads(await settings_store.get(db, KEY, "[]") or "[]")
        return [str(x) for x in v] if isinstance(v, list) else []
    except ValueError:
        return []


async def is_admin(db: AsyncSession, user) -> bool:
    from app.core.permissions import is_owner  # 대표는 항상 관리자 (docs/login_logic D-2)

    if is_owner(user) or getattr(user, "is_superuser", False):
        return True
    return str(getattr(user, "id", "")) in await admin_ids(db)


async def can_claim(db: AsyncSession) -> bool:
    """대표 계정이 있으면 대표가 곧 관리자이므로 아무도 '첫 관리자 지정'을 할 수 없다(docs/login_logic P9).
    매니저가 스스로 관리자가 되어 회사 공통 기업·명단을 고치는 것을 막는다. 관리자 추가는 대표가 [관리자]에서."""
    from sqlalchemy import select

    from app.core.permissions import OWNER
    from app.models.user import User

    owner = (await db.execute(select(User.id).where(User.role == OWNER, User.is_active == True).limit(1))).first()  # noqa: E712
    if owner:
        return False
    return not await admin_ids(db)


async def set_admins(db: AsyncSession, ids: list[str]) -> list[str]:
    ids = list(dict.fromkeys(str(i) for i in ids if i))
    await settings_store.set_value(db, KEY, json.dumps(ids))
    return ids
