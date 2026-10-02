"""Client and ClientAccount CRUD service."""
import uuid
import random
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from app.models.client import Client, ClientAccount
from app.core.encryption import encrypt_ssn, decrypt_ssn, mask_ssn
from app.core.permissions import scope_clients
from app.models.user import User


async def _generate_unique_code(db: AsyncSession) -> str:
    """Generate a 6-digit random code that does not conflict with existing records."""
    while True:
        code = str(random.randint(100000, 999999))
        existing = await db.execute(select(Client).where(Client.unique_code == code))
        if not existing.scalar_one_or_none():
            return code


def _build_client_response(client: Client) -> dict:
    """Attach computed ssn_masked field to a Client ORM object for serialisation.

    We cannot use a @property on the ORM model because decryption depends on
    application-level config, so we attach the value as a plain attribute so
    that Pydantic's from_attributes mode can read it.
    """
    if client.ssn_encrypted:
        try:
            plaintext = decrypt_ssn(client.ssn_encrypted)
            client.ssn_masked = mask_ssn(plaintext)
        except Exception:
            client.ssn_masked = None
    else:
        client.ssn_masked = None
    # 담당 매니저 — 관계가 이미 로드된 경우에만 (비동기 세션에서 지연 로드 방지)
    owner = client.__dict__.get("user")
    client.manager = (
        {"id": owner.id, "nickname": owner.nickname, "phone": owner.phone, "email": owner.email}
        if owner is not None else None
    )
    return client


async def list_clients(db: AsyncSession, actor: User, manager_id: Optional[str] = None) -> list[Client]:
    """접근 가능한 고객 목록. 대표는 전체(또는 manager_id 필터), 매니저는 담당 고객만."""
    stmt = (
        select(Client)
        .options(selectinload(Client.accounts), selectinload(Client.user))
        .order_by(Client.created_at)
    )
    result = await db.execute(scope_clients(stmt, actor, manager_id))
    clients = result.scalars().all()
    return [_build_client_response(c) for c in clients]


async def get_client(db: AsyncSession, actor: User, client_id: str) -> Optional[Client]:
    """소유 조건을 건 채로 조회. 권한 없으면 None(→ 라우터에서 404)."""
    stmt = (
        select(Client)
        .where(Client.id == client_id)
        .options(selectinload(Client.accounts), selectinload(Client.user))
    )
    result = await db.execute(scope_clients(stmt, actor))
    client = result.scalar_one_or_none()
    if client:
        _build_client_response(client)
    return client


async def resolve_new_client_manager(db: AsyncSession, actor: User, manager_id: Optional[str]) -> str:
    """새 고객의 담당자(docs/login_logic P10).

    - 매니저(대행 중 포함): 언제나 본인. 다른 값을 보내도 무시한다.
    - 대표: 반드시 담당자를 고른다(활성 대표·매니저 계정). 고르지 않으면 422.
    """
    from fastapi import HTTPException

    from app.core.permissions import ROLES, is_owner

    if not is_owner(actor):
        return actor.id
    if not manager_id:
        raise HTTPException(status_code=422, detail="담당자를 선택하세요.")
    if manager_id == actor.id:
        return actor.id
    target = await db.get(User, manager_id)
    if target is None or not target.is_active or target.role not in ROLES:
        raise HTTPException(status_code=422, detail="선택한 담당자를 찾을 수 없거나 비활성 계정입니다.")
    return target.id


async def create_client(
    db: AsyncSession,
    user_id: str,
    name: str,
    memo: Optional[str] = None,
    ssn: Optional[str] = None,
    birth_date=None,
    phone: Optional[str] = None,
    email: Optional[str] = None,
) -> Client:
    client_id = str(uuid.uuid4())
    unique_code = await _generate_unique_code(db)
    ssn_encrypted = encrypt_ssn(ssn) if ssn else None

    # birth_date 문자열 → date 변환
    parsed_birth = None
    if birth_date:
        if isinstance(birth_date, str):
            from datetime import datetime as dt
            for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d"):
                try:
                    parsed_birth = dt.strptime(birth_date.strip(), fmt).date()
                    break
                except ValueError:
                    continue
        else:
            parsed_birth = birth_date

    client = Client(
        id=client_id,
        user_id=user_id,
        name=name,
        memo=memo,
        unique_code=unique_code,
        ssn_encrypted=ssn_encrypted,
        birth_date=parsed_birth,
        phone=phone,
        email=email,
    )
    db.add(client)
    await db.commit()
    # Re-fetch with eager loading to avoid lazy load issues
    result = await db.execute(
        select(Client)
        .where(Client.id == client_id)
        .options(selectinload(Client.accounts), selectinload(Client.user))
    )
    client = result.scalar_one()
    return _build_client_response(client)


async def update_client(
    db: AsyncSession,
    actor: User,
    client_id: str,
    name: Optional[str],
    memo: Optional[str],
    ssn: Optional[str] = None,
) -> Optional[Client]:
    client = await get_client(db, actor, client_id)
    if not client:
        return None
    if name is not None:
        client.name = name
    if memo is not None:
        client.memo = memo
    if ssn is not None:
        client.ssn_encrypted = encrypt_ssn(ssn) if ssn else None
    await db.commit()
    # Re-fetch with eager loading
    result = await db.execute(
        select(Client)
        .where(Client.id == client_id)
        .options(selectinload(Client.accounts), selectinload(Client.user))
    )
    client = result.scalar_one()
    return _build_client_response(client)


async def _stored_images(db: AsyncSession, *, client_id: Optional[str] = None,
                         account_id: Optional[str] = None) -> list[str]:
    """지울 고객/계좌에 딸린 업로드 이미지 경로(스냅샷 캡처, 고객이면 문자 이미지까지)."""
    from app.models.message_log import MessageLog
    from app.models.snapshot import PortfolioSnapshot

    q = select(PortfolioSnapshot.image_path).join(ClientAccount, ClientAccount.id == PortfolioSnapshot.client_account_id)
    q = q.where(ClientAccount.id == account_id) if account_id else q.where(ClientAccount.client_id == client_id)
    paths = [p for (p,) in (await db.execute(q)).all() if p]
    if client_id and not account_id:
        paths += [p for (p,) in (await db.execute(
            select(MessageLog.image_path).where(MessageLog.client_id == client_id))).all() if p]
    return paths


def _remove_files(paths: list[str]) -> None:
    from app.core.uploads import remove_quietly

    for p in paths:
        remove_quietly(p)


async def delete_client(db: AsyncSession, actor: User, client_id: str) -> bool:
    client = await get_client(db, actor, client_id)
    if not client:
        return False
    images = await _stored_images(db, client_id=client_id)
    await db.delete(client)
    await db.commit()
    _remove_files(images)  # DB 삭제가 끝난 뒤에만 파일 정리(고아 파일 방지, 수정_tasks P2-13)
    return True


async def list_accounts(db: AsyncSession, client_id: str) -> list[ClientAccount]:
    result = await db.execute(
        select(ClientAccount)
        .where(ClientAccount.client_id == client_id)
        .order_by(ClientAccount.created_at)
    )
    return result.scalars().all()


async def get_account(
    db: AsyncSession, account_id: str, client_id: str
) -> Optional[ClientAccount]:
    result = await db.execute(
        select(ClientAccount).where(
            ClientAccount.id == account_id, ClientAccount.client_id == client_id
        )
    )
    return result.scalar_one_or_none()


async def create_account(
    db: AsyncSession,
    client_id: str,
    account_type: str,
    account_number: Optional[str] = None,
    securities_company: Optional[str] = None,
    representative: Optional[str] = None,
    monthly_payment: Optional[int] = None,
) -> ClientAccount:
    account = ClientAccount(
        id=str(uuid.uuid4()),
        client_id=client_id,
        account_type=account_type,
        account_number=account_number,
        securities_company=securities_company,
        representative=representative,
        monthly_payment=monthly_payment,
    )
    db.add(account)
    await db.commit()
    await db.refresh(account)
    return account


async def update_account(
    db: AsyncSession, account_id: str, client_id: str, data: dict
) -> Optional[ClientAccount]:
    account = await get_account(db, account_id, client_id)
    if not account:
        return None
    for field, value in data.items():
        if value is not None:
            setattr(account, field, value)
    await db.commit()
    await db.refresh(account)
    return account


async def delete_account(
    db: AsyncSession, account_id: str, client_id: str
) -> bool:
    account = await get_account(db, account_id, client_id)
    if not account:
        return False
    images = await _stored_images(db, account_id=account_id)
    await db.delete(account)
    await db.commit()
    _remove_files(images)
    return True
