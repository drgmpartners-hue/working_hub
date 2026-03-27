"""Field Options API - CRUD for user-customizable dropdown options."""
import uuid
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.core.deps import get_current_user
from app.models.field_option import FieldOption

router = APIRouter(prefix="/field-options", tags=["field-options"])


class FieldOptionCreate(BaseModel):
    field_name: str  # 'securities', 'account_type', 'representative'
    value: str
    label: str
    sort_order: int = 0


class FieldOptionUpdate(BaseModel):
    value: Optional[str] = None
    label: Optional[str] = None
    sort_order: Optional[int] = None


class FieldOptionResponse(BaseModel):
    id: str
    field_name: str
    value: str
    label: str
    sort_order: int

    class Config:
        from_attributes = True


@router.get("/{field_name}", response_model=list[FieldOptionResponse])
async def list_options(
    field_name: str,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(FieldOption)
        .where(FieldOption.user_id == current_user.id, FieldOption.field_name == field_name)
        .order_by(FieldOption.sort_order, FieldOption.created_at)
    )
    return result.scalars().all()


@router.post("/{field_name}", response_model=FieldOptionResponse, status_code=201)
async def create_option(
    field_name: str,
    body: FieldOptionCreate,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    option = FieldOption(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        field_name=field_name,
        value=body.value,
        label=body.label,
        sort_order=body.sort_order,
    )
    db.add(option)
    await db.commit()
    await db.refresh(option)
    return option


@router.put("/{field_name}/{option_id}", response_model=FieldOptionResponse)
async def update_option(
    field_name: str,
    option_id: str,
    body: FieldOptionUpdate,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(FieldOption).where(
            FieldOption.id == option_id,
            FieldOption.user_id == current_user.id,
            FieldOption.field_name == field_name,
        )
    )
    option = result.scalar_one_or_none()
    if not option:
        raise HTTPException(status_code=404, detail="Option not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(option, k, v)
    await db.commit()
    await db.refresh(option)
    return option


@router.delete("/{field_name}/{option_id}", status_code=204)
async def delete_option(
    field_name: str,
    option_id: str,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(FieldOption).where(
            FieldOption.id == option_id,
            FieldOption.user_id == current_user.id,
            FieldOption.field_name == field_name,
        )
    )
    option = result.scalar_one_or_none()
    if not option:
        raise HTTPException(status_code=404, detail="Option not found")
    await db.delete(option)
    await db.commit()
