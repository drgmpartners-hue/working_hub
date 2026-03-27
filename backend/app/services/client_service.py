"""Client and ClientAccount CRUD service."""
import uuid
import random
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from app.models.client import Client, ClientAccount
from app.core.encryption import encrypt_ssn, decrypt_ssn, mask_ssn


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
    return client


async def list_clients(db: AsyncSession, user_id: str) -> list[Client]:
    result = await db.execute(
        select(Client)
        .where(Client.user_id == user_id)
        .options(selectinload(Client.accounts))
        .order_by(Client.created_at)
    )
    clients = result.scalars().all()
    return [_build_client_response(c) for c in clients]


async def get_client(db: AsyncSession, user_id: str, client_id: str) -> Optional[Client]:
    result = await db.execute(
        select(Client)
        .where(Client.id == client_id, Client.user_id == user_id)
        .options(selectinload(Client.accounts))
    )
    client = result.scalar_one_or_none()
    if client:
        _build_client_response(client)
    return client


async def create_client(
    db: AsyncSession,
    user_id: str,
    name: str,
    memo: Optional[str] = None,
    ssn: Optional[str] = None,
) -> Client:
    client_id = str(uuid.uuid4())
    unique_code = await _generate_unique_code(db)
    ssn_encrypted = encrypt_ssn(ssn) if ssn else None

    client = Client(
        id=client_id,
        user_id=user_id,
        name=name,
        memo=memo,
        unique_code=unique_code,
        ssn_encrypted=ssn_encrypted,
    )
    db.add(client)
    await db.commit()
    # Re-fetch with eager loading to avoid lazy load issues
    result = await db.execute(
        select(Client)
        .where(Client.id == client_id)
        .options(selectinload(Client.accounts))
    )
    client = result.scalar_one()
    return _build_client_response(client)


async def update_client(
    db: AsyncSession,
    user_id: str,
    client_id: str,
    name: Optional[str],
    memo: Optional[str],
    ssn: Optional[str] = None,
) -> Optional[Client]:
    client = await get_client(db, user_id, client_id)
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
        .options(selectinload(Client.accounts))
    )
    client = result.scalar_one()
    return _build_client_response(client)


async def delete_client(db: AsyncSession, user_id: str, client_id: str) -> bool:
    client = await get_client(db, user_id, client_id)
    if not client:
        return False
    await db.delete(client)
    await db.commit()
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
    await db.delete(account)
    await db.commit()
    return True
