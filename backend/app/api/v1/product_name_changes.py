"""Product Name Changes API — 상품명 변경 메모 CRUD."""
import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional
from app.db.session import get_db
from app.core.deps import get_current_user
from app.models.product_name_change import ProductNameChange

router = APIRouter(prefix="/product-name-changes", tags=["product-name-changes"])


class ChangeCreate(BaseModel):
    old_keyword: str
    new_keyword: str
    memo: Optional[str] = None


class ChangeUpdate(BaseModel):
    old_keyword: Optional[str] = None
    new_keyword: Optional[str] = None
    memo: Optional[str] = None


class ChangeResponse(BaseModel):
    id: str
    old_keyword: str
    new_keyword: str
    memo: Optional[str]

    model_config = {"from_attributes": True}


@router.get("", response_model=list[ChangeResponse])
async def list_changes(
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ProductNameChange).order_by(ProductNameChange.created_at.desc())
    )
    return result.scalars().all()


@router.post("", response_model=ChangeResponse, status_code=201)
async def create_change(
    body: ChangeCreate,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # 빈 old_keyword가 저장되면 replace("")가 모든 상품명을 파괴하므로 반드시 차단
    if not body.old_keyword.strip():
        raise HTTPException(400, "변경 전 키워드(old_keyword)는 비워둘 수 없습니다.")
    rec = ProductNameChange(
        id=str(uuid.uuid4()),
        old_keyword=body.old_keyword.strip(),
        new_keyword=body.new_keyword.strip(),
        memo=body.memo,
    )
    db.add(rec)
    await db.commit()
    await db.refresh(rec)
    return rec


@router.put("/{change_id}", response_model=ChangeResponse)
async def update_change(
    change_id: str,
    body: ChangeUpdate,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rec = await db.get(ProductNameChange, change_id)
    if not rec:
        raise HTTPException(404, "Not found")
    if body.old_keyword is not None:
        if not body.old_keyword.strip():
            raise HTTPException(400, "변경 전 키워드(old_keyword)는 비워둘 수 없습니다.")
        rec.old_keyword = body.old_keyword.strip()
    if body.new_keyword is not None:
        rec.new_keyword = body.new_keyword.strip()
    if body.memo is not None:
        rec.memo = body.memo
    await db.commit()
    await db.refresh(rec)
    return rec


@router.delete("/{change_id}", status_code=204)
async def delete_change(
    change_id: str,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rec = await db.get(ProductNameChange, change_id)
    if not rec:
        raise HTTPException(404, "Not found")
    await db.delete(rec)
    await db.commit()
