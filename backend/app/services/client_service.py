"""Client and ClientAccount CRUD service."""
import uuid
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.client import Client, ClientAccount


async def list_clients(db: AsyncSession, user_id: str) -> list[Client]:
    result = await db.execute(
        select(Client).where(Client.user_id == user_id).order_by(Client.created_at)
    )
    return result.scalars().all()


async def get_client(db: AsyncSession, user_id: str, client_id: str) -> Optional[Client]:
    result = await db.execute(
        select(Client).where(Client.id == client_id, Client.user_id == user_id)
    )
    return result.scalar_one_or_none()


async def create_client(
    db: AsyncSession, user_id: str, name: str, memo: Optional[str] = None
) -> Client:
    client = Client(id=str(uuid.uuid4()), user_id=user_id, name=name, memo=memo)
    db.add(client)
    await db.commit()
    await db.refresh(client)
    return client


async def update_client(
    db: AsyncSession,
    user_id: str,
    client_id: str,
    name: Optional[str],
    memo: Optional[str],
) -> Optional[Client]:
    client = await get_client(db, user_id, client_id)
    if not client:
        return None
    if name is not None:
        client.name = name
    if memo is not None:
        client.memo = memo
    await db.commit()
    await db.refresh(client)
    return client


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
    monthly_payment: Optional[int] = None,
) -> ClientAccount:
    account = ClientAccount(
        id=str(uuid.uuid4()),
        client_id=client_id,
        account_type=account_type,
        account_number=account_number,
        securities_company=securities_company,
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
