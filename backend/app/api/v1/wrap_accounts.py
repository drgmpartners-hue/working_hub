"""Investment Product Catalog API — CRUD + select options."""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.wrap_account import WrapAccount, ProductSelectOption
from app.schemas.wrap_account import (
    WrapAccountCreate, WrapAccountResponse, WrapAccountUpdate,
    ProductOptionCreate, ProductOptionResponse,
)

router = APIRouter(prefix="/retirement/wrap-accounts", tags=["investment-products"])

ALL_FIELDS = [
    'product_name', 'in_out', 'category', 'asset_class_1', 'asset_class_2',
    'institution', 'period', 'risk_level', 'currency',
    'total_expected_return', 'annual_expected_return',
    'securities_company', 'investment_target', 'target_return_rate', 'description',
    'is_active',
] + [f'port_{i}' for i in range(1, 11)]


@router.get("", response_model=list[WrapAccountResponse])
async def list_wrap_accounts(
    is_active: Optional[bool] = None,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(WrapAccount).order_by(WrapAccount.id)
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
    data = body.model_dump(exclude_unset=True)
    account = WrapAccount(**data)
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
    account = await db.get(WrapAccount, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Product not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(account, field, value)
    await db.commit()
    await db.refresh(account)
    return account


@router.delete("/{account_id}", status_code=204)
async def delete_wrap_account(
    account_id: int,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    account = await db.get(WrapAccount, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Product not found")
    await db.delete(account)
    await db.commit()


# ── Select Options CRUD ──

@router.get("/options", response_model=list[ProductOptionResponse])
async def list_options(
    field_name: Optional[str] = None,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(ProductSelectOption).order_by(ProductSelectOption.field_name, ProductSelectOption.sort_order, ProductSelectOption.option_value)
    if field_name:
        stmt = stmt.where(ProductSelectOption.field_name == field_name)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("/options", response_model=ProductOptionResponse, status_code=201)
async def create_option(
    body: ProductOptionCreate,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    opt = ProductSelectOption(field_name=body.field_name, option_value=body.option_value, sort_order=body.sort_order)
    db.add(opt)
    await db.commit()
    await db.refresh(opt)
    return opt


@router.put("/options/{option_id}", response_model=ProductOptionResponse)
async def update_option(
    option_id: int,
    body: ProductOptionCreate,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    opt = await db.get(ProductSelectOption, option_id)
    if not opt:
        raise HTTPException(status_code=404, detail="Option not found")
    old_value = opt.option_value
    opt.field_name = body.field_name
    opt.option_value = body.option_value
    opt.sort_order = body.sort_order
    # Update all products referencing the old value
    if old_value != body.option_value:
        field = body.field_name
        if hasattr(WrapAccount, field):
            stmt = select(WrapAccount).where(getattr(WrapAccount, field) == old_value)
            result = await db.execute(stmt)
            for product in result.scalars().all():
                setattr(product, field, body.option_value)
    await db.commit()
    await db.refresh(opt)
    return opt


@router.delete("/options/{option_id}", status_code=204)
async def delete_option(
    option_id: int,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    opt = await db.get(ProductSelectOption, option_id)
    if not opt:
        raise HTTPException(status_code=404, detail="Option not found")
    await db.delete(opt)
    await db.commit()
