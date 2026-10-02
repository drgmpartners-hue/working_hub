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


def clean(values: dict) -> dict:
    """앞뒤 공백 제거, 빈 문자열은 None(칸 비우기). 수정_tasks P2-10."""
    out = {}
    for k, v in values.items():
        if isinstance(v, str):
            v = v.strip() or None
        out[k] = v
    return out


async def usage(db: AsyncSession, name: str) -> dict:
    """이 상품명을 쓰는 곳(이름으로 연결됨): 보유 종목(스냅샷), 추천 포트폴리오 항목."""
    from sqlalchemy import func

    from app.models.recommended_portfolio import RecommendedPortfolioItem
    from app.models.snapshot import PortfolioHolding

    holdings = (await db.execute(select(func.count()).select_from(PortfolioHolding)
                                 .where(PortfolioHolding.product_name == name))).scalar_one()
    rec = (await db.execute(select(func.count()).select_from(RecommendedPortfolioItem)
                            .where(RecommendedPortfolioItem.product_name == name))).scalar_one()
    return {"holdings": int(holdings), "recommended_items": int(rec), "total": int(holdings) + int(rec)}


async def update(
    db: AsyncSession,
    product: ProductMaster,
    data: ProductMasterUpdate,
) -> ProductMaster:
    """제공된 필드만 업데이트 (exclude_unset). 빈 문자열·null 이면 그 칸을 비운다."""
    for field, value in clean(data.model_dump(exclude_unset=True)).items():
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
