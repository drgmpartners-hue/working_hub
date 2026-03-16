"""Service layer for ProductMaster — 상품 마스터 CRUD."""
import uuid
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_
from app.models.product_master import ProductMaster
from app.schemas.product_master import ProductMasterCreate, ProductMasterUpdate


async def list_all(
    db: AsyncSession,
    q: Optional[str] = None,
) -> list[ProductMaster]:
    """전체 목록 반환. q 제공 시 product_name 또는 product_code에서 부분 일치 검색."""
    stmt = select(ProductMaster)
    if q:
        pattern = f"%{q}%"
        stmt = stmt.where(
            or_(
                ProductMaster.product_name.ilike(pattern),
                ProductMaster.product_code.ilike(pattern),
            )
        )
    stmt = stmt.order_by(ProductMaster.product_name)
    result = await db.execute(stmt)
    return result.scalars().all()


async def get_by_id(
    db: AsyncSession,
    product_id: str,
) -> Optional[ProductMaster]:
    """ID로 단건 조회."""
    result = await db.execute(
        select(ProductMaster).where(ProductMaster.id == product_id)
    )
    return result.scalar_one_or_none()


async def lookup_by_name(
    db: AsyncSession,
    name: str,
) -> Optional[ProductMaster]:
    """상품명 정확 일치로 위험도/지역 조회 (홀딩 매핑용)."""
    result = await db.execute(
        select(ProductMaster).where(ProductMaster.product_name == name)
    )
    return result.scalar_one_or_none()


async def get_by_name(
    db: AsyncSession,
    name: str,
) -> Optional[ProductMaster]:
    """중복 확인용 이름 조회."""
    result = await db.execute(
        select(ProductMaster).where(ProductMaster.product_name == name)
    )
    return result.scalar_one_or_none()


async def create(
    db: AsyncSession,
    data: ProductMasterCreate,
) -> ProductMaster:
    """신규 상품 등록."""
    product = ProductMaster(
        id=str(uuid.uuid4()),
        product_name=data.product_name,
        product_code=data.product_code,
        risk_level=data.risk_level,
        region=data.region,
        product_type=data.product_type,
    )
    db.add(product)
    await db.commit()
    await db.refresh(product)
    return product


async def update(
    db: AsyncSession,
    product: ProductMaster,
    data: ProductMasterUpdate,
) -> ProductMaster:
    """제공된 필드만 업데이트 (exclude_unset)."""
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(product, field, value)
    await db.commit()
    await db.refresh(product)
    return product


async def delete(
    db: AsyncSession,
    product: ProductMaster,
) -> None:
    """상품 삭제."""
    await db.delete(product)
    await db.commit()
