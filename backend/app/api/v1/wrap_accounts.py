"""Wrap Accounts API — retirement wrap product catalog CRUD."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.wrap_account import WrapAccount
from app.schemas.wrap_account import (
    WrapAccountCreate,
    WrapAccountResponse,
    WrapAccountUpdate,
)

router = APIRouter(prefix="/retirement/wrap-accounts", tags=["wrap-accounts"])


@router.get("", response_model=list[WrapAccountResponse])
async def list_wrap_accounts(
    is_active: Optional[bool] = None,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return wrap accounts, optionally filtered by is_active."""
    stmt = select(WrapAccount).order_by(WrapAccount.created_at.desc())
    if is_active is not None:
        stmt = stmt.where(WrapAccount.is_active == is_active)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("", response_model=WrapAccountResponse, status_code=201)
async def create_wrap_account(
    body: WrapAccountCreate,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new wrap account product."""
    account = WrapAccount(
        product_name=body.product_name,
        securities_company=body.securities_company,
        investment_target=body.investment_target,
        target_return_rate=body.target_return_rate,
        description=body.description,
        is_active=body.is_active,
    )
    db.add(account)
    await db.commit()
    await db.refresh(account)
    return account


@router.put("/{account_id}", response_model=WrapAccountResponse)
async def update_wrap_account(
    account_id: int,
    body: WrapAccountUpdate,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Partially update a wrap account."""
    account = await db.get(WrapAccount, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Wrap account not found")

    if body.product_name is not None:
        account.product_name = body.product_name
    if body.securities_company is not None:
        account.securities_company = body.securities_company
    if body.investment_target is not None:
        account.investment_target = body.investment_target
    if body.target_return_rate is not None:
        account.target_return_rate = body.target_return_rate
    if body.description is not None:
        account.description = body.description
    if body.is_active is not None:
        account.is_active = body.is_active

    await db.commit()
    await db.refresh(account)
    return account


@router.delete("/{account_id}", status_code=204)
async def delete_wrap_account(
    account_id: int,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Soft-delete a wrap account by setting is_active = False."""
    account = await db.get(WrapAccount, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Wrap account not found")

    account.is_active = False
    await db.commit()
