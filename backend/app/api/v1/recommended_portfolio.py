"""Dr.GM 추천 포트폴리오 API — 전 고객 공통 추천 포트폴리오 템플릿 관리."""
import uuid
import logging
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.core.deps import get_current_user
from app.models.recommended_portfolio import RecommendedPortfolioItem
from app.services.stock_search_service import get_stock_price

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/recommended-portfolio", tags=["recommended-portfolio"])


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class RecommendedPortfolioItemIn(BaseModel):
    product_name: str
    product_code: Optional[str] = None
    product_type: Optional[str] = None
    region: Optional[str] = None
    current_price: Optional[float] = None
    weight_pension: Optional[float] = None
    weight_irp: Optional[float] = None
    memo: Optional[str] = None
    seq: int = 0


class RecommendedPortfolioItemOut(BaseModel):
    id: str
    product_name: str
    product_code: Optional[str] = None
    product_type: Optional[str] = None
    region: Optional[str] = None
    current_price: Optional[float] = None
    weight_pension: Optional[float] = None
    weight_irp: Optional[float] = None
    memo: Optional[str] = None
    seq: int

    model_config = {"from_attributes": True}


class RecommendedPortfolioSaveBody(BaseModel):
    items: List[RecommendedPortfolioItemIn]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("", response_model=List[RecommendedPortfolioItemOut])
async def get_recommended_portfolio(
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """전체 추천 포트폴리오 목록 조회 (seq 순 정렬)."""
    result = await db.execute(
        select(RecommendedPortfolioItem).order_by(RecommendedPortfolioItem.seq)
    )
    items = result.scalars().all()
    return items


@router.put("", response_model=List[RecommendedPortfolioItemOut])
async def save_recommended_portfolio(
    body: RecommendedPortfolioSaveBody,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """전체 추천 포트폴리오 저장 (기존 데이터 전부 삭제 후 새로 삽입)."""
    # 기존 데이터 전체 삭제
    await db.execute(delete(RecommendedPortfolioItem))

    # 새 데이터 삽입
    new_items = []
    for item_in in body.items:
        new_item = RecommendedPortfolioItem(
            id=str(uuid.uuid4()),
            product_name=item_in.product_name,
            product_code=item_in.product_code,
            product_type=item_in.product_type,
            region=item_in.region,
            current_price=item_in.current_price,
            weight_pension=item_in.weight_pension,
            weight_irp=item_in.weight_irp,
            memo=item_in.memo,
            seq=item_in.seq,
        )
        db.add(new_item)
        new_items.append(new_item)

    await db.commit()

    # seq 순 재조회하여 반환
    result = await db.execute(
        select(RecommendedPortfolioItem).order_by(RecommendedPortfolioItem.seq)
    )
    saved_items = result.scalars().all()
    return saved_items


@router.post("/refresh-prices", response_model=List[RecommendedPortfolioItemOut])
async def refresh_prices(
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """종목코드가 있는 ETF/주식 항목의 현재가를 Naver Finance에서 갱신.

    product_type이 '펀드'인 항목은 스킵합니다.
    """
    result = await db.execute(
        select(RecommendedPortfolioItem).order_by(RecommendedPortfolioItem.seq)
    )
    items = result.scalars().all()

    updated_count = 0
    for item in items:
        # 펀드 유형이거나 종목코드가 없으면 스킵
        if not item.product_code:
            continue
        if item.product_type and "펀드" in item.product_type:
            continue

        try:
            price_data = await get_stock_price(item.product_code)
            if price_data:
                price = price_data.get("nav") or price_data.get("price")
                if price is not None:
                    item.current_price = float(price)
                    updated_count += 1
        except Exception as e:
            logger.warning(
                "Failed to refresh price for %s (%s): %s",
                item.product_name,
                item.product_code,
                e,
            )

    await db.commit()
    logger.info("Refreshed prices for %d items", updated_count)

    # 최신 상태 재조회
    result = await db.execute(
        select(RecommendedPortfolioItem).order_by(RecommendedPortfolioItem.seq)
    )
    return result.scalars().all()
