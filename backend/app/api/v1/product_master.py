"""Product Master API — 상품명 ↔ 위험도/지역 마스터 관리."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional, Annotated
from app.core.permissions import require_master_write
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
    require_master_write(current_user)  # 전사 공용 마스터 쓰기는 대표만 (지시서 4.2 계층 C)
    fields = product_master_service.clean(data.model_dump())
    if not fields.get("product_name"):
        raise HTTPException(status_code=422, detail="상품명은 비울 수 없습니다.")
    data = ProductMasterCreate(**fields)
    existing = await product_master_service.get_by_name(db, data.product_name)
    if existing:
        raise HTTPException(status_code=409, detail=f"이미 있는 상품명입니다: {data.product_name}")
    try:
        return await product_master_service.create(db, data)
    except IntegrityError:  # 동시에 같은 이름을 등록한 경우
        await db.rollback()
        raise HTTPException(status_code=409, detail=f"이미 있는 상품명입니다: {data.product_name}")


@router.put("/{product_id}", response_model=ProductMasterResponse)
async def update_product(
    product_id: str,
    data: ProductMasterUpdate,
    current_user = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """상품 위험도/지역 등 수정. 빈 값을 보내면 그 칸을 비운다(상품명은 비울 수 없음)."""
    require_master_write(current_user)  # 전사 공용 마스터 쓰기는 대표만 (지시서 4.2 계층 C)
    product = await product_master_service.get_by_id(db, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    fields = product_master_service.clean(data.model_dump(exclude_unset=True))
    if "product_name" in fields:
        new_name = fields["product_name"]
        if not new_name:
            raise HTTPException(status_code=422, detail="상품명은 비울 수 없습니다.")
        other = await product_master_service.get_by_name(db, new_name)
        if other and other.id != product.id:  # 예전: 다른 상품 이름으로 바꾸면 500
            raise HTTPException(status_code=409, detail=f"이미 있는 상품명입니다: {new_name}")
    try:
        return await product_master_service.update(db, product, ProductMasterUpdate(**fields))
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="이미 있는 상품명입니다.")


@router.get("/{product_id}/usage")
async def product_usage(
    product_id: str,
    current_user = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """이 상품명을 쓰는 보유 종목·추천 포트폴리오 항목 수(삭제 전 확인용)."""
    product = await product_master_service.get_by_id(db, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return await product_master_service.usage(db, product.product_name)


@router.delete("/{product_id}", status_code=204)
async def delete_product(
    product_id: str,
    force: bool = Query(False, description="쓰는 곳이 있어도 삭제"),
    current_user = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """상품 삭제. 이 이름을 쓰는 보유 종목·추천 항목이 있으면 409(사용처 수 포함) — force=true 로 다시 요청하면 삭제.
    (보유 종목은 이름으로 연결돼 있어 지워지지 않고, 위험도·지역 자동 매핑만 사라진다.)"""
    require_master_write(current_user)  # 전사 공용 마스터 쓰기는 대표만 (지시서 4.2 계층 C)
    product = await product_master_service.get_by_id(db, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    if not force:
        used = await product_master_service.usage(db, product.product_name)
        if used["total"]:
            raise HTTPException(status_code=409, detail={
                "message": f"이 상품을 쓰는 곳이 있습니다(보유 종목 {used['holdings']}건, 추천 포트폴리오 {used['recommended_items']}건).",
                "usage": used,
            })
    await product_master_service.delete(db, product)
