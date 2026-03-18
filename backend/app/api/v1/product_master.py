"""Product Master API — 상품명 ↔ 위험도/지역 마스터 관리."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional, Annotated
from app.db.session import get_db
from app.core.deps import CurrentUser, get_current_user
from app.schemas.product_master import (
    ProductMasterCreate,
    ProductMasterUpdate,
    ProductMasterResponse,
    ProductMasterLookupResponse,
)
from app.services import product_master_service

router = APIRouter(prefix="/product-master", tags=["product-master"])


@router.get("/lookup", response_model=ProductMasterLookupResponse)
async def lookup_product(
    name: str = Query(..., description="상품명 정확 일치 검색"),
    current_user = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """상품명으로 위험도/지역 조회 — 홀딩 자동 매핑용."""
    product = await product_master_service.lookup_by_name(db, name)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return product


@router.get("", response_model=list[ProductMasterResponse])
async def list_products(
    q: Optional[str] = Query(None, description="상품명/종목코드 검색"),
    current_user = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """전체 상품 목록 조회. q 파라미터로 부분 검색 가능."""
    return await product_master_service.list_all(db, q)


@router.post("", response_model=ProductMasterResponse, status_code=201)
async def create_product(
    data: ProductMasterCreate,
    current_user = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """신규 상품 등록."""
    existing = await product_master_service.get_by_name(db, data.product_name)
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"Product name already exists: {data.product_name}",
        )
    return await product_master_service.create(db, data)


@router.put("/{product_id}", response_model=ProductMasterResponse)
async def update_product(
    product_id: str,
    data: ProductMasterUpdate,
    current_user = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """상품 위험도/지역 등 수정."""
    product = await product_master_service.get_by_id(db, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return await product_master_service.update(db, product, data)


@router.delete("/{product_id}", status_code=204)
async def delete_product(
    product_id: str,
    current_user = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """상품 삭제."""
    product = await product_master_service.get_by_id(db, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    await product_master_service.delete(db, product)
