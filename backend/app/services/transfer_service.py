"""고객 담당자 이관 (docs/login_logic P5, 지시서 9장).

계층 A 데이터는 전부 clients 에 매달려 있으므로 clients.user_id 하나만 바꾸면 하위 데이터가 함께 이동한다.
- message_logs.user_id 는 바꾸지 않는다(발송 당시 실제 발송자 보존). 조회 권한은 이미 client_id 기준.
- 계층 B(수당·콘텐츠·분석·문자 템플릿·드롭다운 설정)는 이동하지 않는다.
- 일괄 이관(퇴사 처리)에서는 기업 리포트의 '매니저 추가 기업'과 브리핑 수신자 명단도 함께 넘긴다(P9).
  대표에게 넘기면 그 기업은 회사 공통, 수신자는 회사 명단이 된다.
권한 판정(대표만·대행 중 금지)은 라우터에서 끝낸 뒤 호출한다.
"""
from __future__ import annotations

from typing import Optional

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import ROLES
from app.models.client import Client
from app.models.client_transfer import ClientTransfer
from app.models.user import User


async def validate_target(db: AsyncSession, to_user_id: str) -> User:
    """이관 대상: 존재·활성·역할(owner/manager). 비활성 계정으로 넘기면 고객이 접근 불가가 된다."""
    target = (await db.execute(select(User).where(User.id == to_user_id))).scalar_one_or_none()
    if target is None:
        raise HTTPException(status_code=404, detail="이관 받을 계정을 찾을 수 없습니다.")
    if not target.is_active:
        raise HTTPException(status_code=400, detail="비활성 계정으로는 이관할 수 없습니다.")
    if target.role not in ROLES:
        raise HTTPException(status_code=400, detail="이관 받을 수 없는 계정입니다.")
    return target


async def transfer_client(
    db: AsyncSession, client: Client, target: User, performed_by: str, reason: Optional[str]
) -> ClientTransfer:
    if client.user_id == target.id:
        raise HTTPException(status_code=400, detail="이미 해당 담당자의 고객입니다.")
    row = ClientTransfer(
        client_id=client.id,
        from_user_id=client.user_id,
        to_user_id=target.id,
        performed_by_user_id=performed_by,
        reason=(reason or "").strip()[:300] or None,
    )
    db.add(row)
    client.user_id = target.id
    await db.commit()
    await db.refresh(row)
    return row


async def transfer_all(
    db: AsyncSession, from_user: User, target: User, performed_by: str, reason: Optional[str]
) -> int:
    """한 매니저의 전 고객을 단일 트랜잭션으로 이관. 이관 건수 반환."""
    if from_user.id == target.id:
        raise HTTPException(status_code=400, detail="같은 계정으로는 이관할 수 없습니다.")
    ids = (await db.execute(select(Client.id).where(Client.user_id == from_user.id))).scalars().all()
    note = (reason or "").strip()[:300] or None
    try:
        await _move_company_report(db, from_user.id, target)
        db.add_all(
            [
                ClientTransfer(
                    client_id=cid,
                    from_user_id=from_user.id,
                    to_user_id=target.id,
                    performed_by_user_id=performed_by,
                    reason=note,
                )
                for cid in ids
            ]
        )
        if ids:
            await db.execute(update(Client).where(Client.id.in_(ids)).values(user_id=target.id))
        await db.commit()
    except Exception:
        await db.rollback()
        raise
    return len(ids)


async def _move_company_report(db: AsyncSession, from_id: str, target: User) -> None:
    """기업 리포트 담당 이동(커밋은 호출한 쪽). 같은 사람이 이미 받는 명단에 있으면 중복 행은 지운다."""
    from sqlalchemy import delete

    from app.core.permissions import MANAGER
    from app.models.news_briefing import BriefingRecipient, CompanyHidden, PortfolioCompany

    new_owner = target.id if target.role == MANAGER else None
    await db.execute(update(PortfolioCompany).where(PortfolioCompany.manager_user_id == from_id)
                     .values(manager_user_id=new_owner))
    in_target = (BriefingRecipient.manager_user_id == new_owner) if new_owner else BriefingRecipient.manager_user_id.is_(None)
    have = (await db.execute(select(BriefingRecipient.user_id, BriefingRecipient.client_id).where(in_target))).all()
    have_u = {u for u, _ in have if u}
    have_c = {c for _, c in have if c}
    for r in (await db.execute(select(BriefingRecipient).where(BriefingRecipient.manager_user_id == from_id))).scalars().all():
        if (r.user_id and r.user_id in have_u) or (r.client_id and r.client_id in have_c):
            await db.delete(r)
        else:
            r.manager_user_id = new_owner
    await db.execute(delete(CompanyHidden).where(CompanyHidden.user_id == from_id))


async def history(db: AsyncSession, client_id: str) -> list[dict]:
    rows = (
        await db.execute(
            select(ClientTransfer).where(ClientTransfer.client_id == client_id).order_by(ClientTransfer.created_at.desc())
        )
    ).scalars().all()
    ids = {r.from_user_id for r in rows} | {r.to_user_id for r in rows} | {r.performed_by_user_id for r in rows}
    ids.discard(None)
    names = {}
    if ids:
        names = dict((await db.execute(select(User.id, User.nickname).where(User.id.in_(ids)))).all())
    return [
        {
            "id": r.id,
            "created_at": r.created_at,
            "from_user_id": r.from_user_id,
            "from": names.get(r.from_user_id),
            "to_user_id": r.to_user_id,
            "to": names.get(r.to_user_id),
            "performed_by": names.get(r.performed_by_user_id),
            "reason": r.reason,
        }
        for r in rows
    ]
