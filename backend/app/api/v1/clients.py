"""Clients API - CRUD for clients and their accounts."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import get_db
from app.core.deps import CurrentUser
from app.schemas.client import (
    ClientCreate,
    ClientUpdate,
    ClientResponse,
    AccountCreate,
    AccountUpdate,
    AccountResponse,
)
from app.services import client_service

router = APIRouter(prefix="/clients", tags=["clients"])


@router.get("", response_model=list[ClientResponse])
async def list_clients(
    current_user=Depends(CurrentUser),
    db: AsyncSession = Depends(get_db),
):
    clients = await client_service.list_clients(db, current_user.id)
    for client in clients:
        client.accounts = await client_service.list_accounts(db, client.id)
    return clients


@router.post("", response_model=ClientResponse, status_code=201)
async def create_client(
    body: ClientCreate,
    current_user=Depends(CurrentUser),
    db: AsyncSession = Depends(get_db),
):
    return await client_service.create_client(db, current_user.id, body.name, body.memo)


@router.put("/{client_id}", response_model=ClientResponse)
async def update_client(
    client_id: str,
    body: ClientUpdate,
    current_user=Depends(CurrentUser),
    db: AsyncSession = Depends(get_db),
):
    client = await client_service.update_client(
        db, current_user.id, client_id, body.name, body.memo
    )
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return client


@router.delete("/{client_id}", status_code=204)
async def delete_client(
    client_id: str,
    current_user=Depends(CurrentUser),
    db: AsyncSession = Depends(get_db),
):
    ok = await client_service.delete_client(db, current_user.id, client_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Client not found")


@router.get("/{client_id}/accounts", response_model=list[AccountResponse])
async def list_accounts(
    client_id: str,
    current_user=Depends(CurrentUser),
    db: AsyncSession = Depends(get_db),
):
    client = await client_service.get_client(db, current_user.id, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return await client_service.list_accounts(db, client_id)


@router.post("/{client_id}/accounts", response_model=AccountResponse, status_code=201)
async def create_account(
    client_id: str,
    body: AccountCreate,
    current_user=Depends(CurrentUser),
    db: AsyncSession = Depends(get_db),
):
    client = await client_service.get_client(db, current_user.id, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return await client_service.create_account(
        db,
        client_id,
        body.account_type,
        body.account_number,
        body.securities_company,
        body.monthly_payment,
    )


@router.put("/{client_id}/accounts/{account_id}", response_model=AccountResponse)
async def update_account(
    client_id: str,
    account_id: str,
    body: AccountUpdate,
    current_user=Depends(CurrentUser),
    db: AsyncSession = Depends(get_db),
):
    account = await client_service.update_account(
        db, account_id, client_id, body.model_dump(exclude_unset=True)
    )
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    return account


@router.delete("/{client_id}/accounts/{account_id}", status_code=204)
async def delete_account(
    client_id: str,
    account_id: str,
    current_user=Depends(CurrentUser),
    db: AsyncSession = Depends(get_db),
):
    ok = await client_service.delete_account(db, account_id, client_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Account not found")
