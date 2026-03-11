"""Brand settings endpoints."""
import uuid
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.db.session import get_db
from app.models.brand import BrandSetting
from app.schemas.brand import BrandSettingResponse, BrandSettingUpdate
from app.core.deps import CurrentUser

router = APIRouter(prefix="/brand", tags=["brand"])


@router.get("", response_model=BrandSettingResponse)
async def get_brand_settings(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Get brand settings. Returns first record or creates a default one if none exists."""
    result = await db.execute(select(BrandSetting).limit(1))
    brand = result.scalar_one_or_none()

    if brand is None:
        brand = BrandSetting(
            id=str(uuid.uuid4()),
            company_name="My Company",
            primary_color="#000000",
        )
        db.add(brand)
        await db.commit()
        await db.refresh(brand)

    return brand


@router.put("", response_model=BrandSettingResponse)
async def update_brand_settings(
    brand_update: BrandSettingUpdate,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Update brand settings. Creates a default record first if none exists."""
    result = await db.execute(select(BrandSetting).limit(1))
    brand = result.scalar_one_or_none()

    if brand is None:
        brand = BrandSetting(
            id=str(uuid.uuid4()),
            company_name="My Company",
            primary_color="#000000",
        )
        db.add(brand)

    update_data = brand_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(brand, field, value)

    await db.commit()
    await db.refresh(brand)
    return brand
