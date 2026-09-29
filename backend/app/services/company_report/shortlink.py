"""카톡 브리핑 본문에 넣는 짧은 기사 링크.

https://working-hub.vercel.app/r/Ab3dE9 → (프론트 /r/[code]) → 백엔드 /api/v1/company-report/r/{code} → 원문 기사
- 같은 주소는 같은 코드를 다시 쓴다(url_hash unique)
- 로그인 없이 열리지만, 저장된 기사 주소로 보내기만 하므로 내부 정보는 드러나지 않는다
"""
from __future__ import annotations

import hashlib
import secrets
import string
from typing import Iterable, Optional

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.company_report import ShortLink
from app.services.company_report import config

ALPHABET = string.ascii_letters + string.digits
CODE_LEN = 6


def _hash(url: str) -> str:
    return hashlib.sha256(url.strip().encode()).hexdigest()


def short_url(code: str) -> str:
    return f"{config.WEB_BASE}/r/{code}"


async def codes_for(db: AsyncSession, items: Iterable[tuple[str, Optional[str]]]) -> dict[str, str]:
    """[(url, article_id)] → {url: 짧은 주소}. 없으면 만든다."""
    pairs = [(u.strip(), aid) for u, aid in items if u and u.strip().startswith(("http://", "https://"))]
    if not pairs:
        return {}
    by_hash = {_hash(u): (u, aid) for u, aid in pairs}
    rows = (await db.execute(select(ShortLink.url_hash, ShortLink.code).where(ShortLink.url_hash.in_(list(by_hash))))).all()
    found = {h: c for h, c in rows}
    for h, (u, aid) in by_hash.items():
        if h in found:
            continue
        for _ in range(5):
            code = "".join(secrets.choice(ALPHABET) for _ in range(CODE_LEN))
            stmt = pg_insert(ShortLink).values(code=code, url=u, url_hash=h, article_id=aid).on_conflict_do_nothing()
            res = await db.execute(stmt)
            if res.rowcount:
                found[h] = code
                break
            # 같은 주소를 동시에 만든 경우
            existing = (await db.execute(select(ShortLink.code).where(ShortLink.url_hash == h))).scalar_one_or_none()
            if existing:
                found[h] = existing
                break
    await db.flush()
    return {by_hash[h][0]: short_url(c) for h, c in found.items()}


async def resolve(db: AsyncSession, code: str) -> Optional[str]:
    link = await db.get(ShortLink, code)
    if not link:
        return None
    await db.execute(update(ShortLink).where(ShortLink.code == code).values(hits=ShortLink.hits + 1))
    await db.commit()
    return link.url
