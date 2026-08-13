"""Dr.GM 추천 포트폴리오 API — 전 고객 공통 추천 포트폴리오 템플릿 관리.

포트폴리오(탭)를 최대 MAX_PORTFOLIOS개까지 두고, 각 탭이 상품 목록을 갖는다.
연금저축용 / IRP용처럼 구성이 다른 조합을 미리 저장해 두고 꺼내 쓰기 위한 구조.
"""
import uuid
import logging
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, delete, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.core.deps import get_current_user
from app.models.recommended_portfolio import (
    RecommendedPortfolio,
    RecommendedPortfolioItem,
    MAX_PORTFOLIOS,
)
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
    # 탭별로 기억하는 화면 설정 (없으면 기존 값 유지)
    account_type: Optional[str] = None
    monthly_amount: Optional[float] = None
    lump_sum_amount: Optional[float] = None


class PortfolioOut(BaseModel):
    id: str
    name: str
    seq: int
    account_type: Optional[str] = None
    monthly_amount: Optional[float] = None
    lump_sum_amount: Optional[float] = None

    model_config = {"from_attributes": True}


class PortfolioCreateBody(BaseModel):
    name: Optional[str] = None


class PortfolioUpdateBody(BaseModel):
    name: Optional[str] = None
    account_type: Optional[str] = None
    monthly_amount: Optional[float] = None
    lump_sum_amount: Optional[float] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _list_portfolios(db: AsyncSession) -> List[RecommendedPortfolio]:
    result = await db.execute(
        select(RecommendedPortfolio).order_by(
            RecommendedPortfolio.seq, RecommendedPortfolio.created_at
        )
    )
    return list(result.scalars().all())


async def _ensure_default_portfolio(db: AsyncSession) -> RecommendedPortfolio:
    """탭이 하나도 없으면 기본 탭을 만든다.

    기존에 탭 없이 저장된 항목(portfolio_id IS NULL)이 있으면 그 탭으로 귀속시킨다.
    """
    portfolios = await _list_portfolios(db)
    if portfolios:
        return portfolios[0]

    default = RecommendedPortfolio(
        id=str(uuid.uuid4()), name="포트폴리오 1", seq=0, account_type="pension"
    )
    db.add(default)
    await db.flush()

    orphans = await db.execute(
        select(RecommendedPortfolioItem).where(
            RecommendedPortfolioItem.portfolio_id.is_(None)
        )
    )
    for item in orphans.scalars().all():
        item.portfolio_id = default.id

    await db.commit()
    await db.refresh(default)
    return default


async def _get_portfolio_or_404(portfolio_id: str, db: AsyncSession) -> RecommendedPortfolio:
    result = await db.execute(
        select(RecommendedPortfolio).where(RecommendedPortfolio.id == portfolio_id)
    )
    portfolio = result.scalar_one_or_none()
    if not portfolio:
        raise HTTPException(status_code=404, detail="추천 포트폴리오를 찾을 수 없습니다.")
    return portfolio


async def _items_of(portfolio_id: str, db: AsyncSession) -> List[RecommendedPortfolioItem]:
    result = await db.execute(
        select(RecommendedPortfolioItem)
        .where(RecommendedPortfolioItem.portfolio_id == portfolio_id)
        .order_by(RecommendedPortfolioItem.seq)
    )
    return list(result.scalars().all())


async def _resolve_portfolio_id(portfolio_id: Optional[str], db: AsyncSession) -> str:
    """portfolio_id가 없으면 첫 번째 탭(없으면 새로 만든 기본 탭)을 쓴다."""
    if portfolio_id:
        await _get_portfolio_or_404(portfolio_id, db)
        return portfolio_id
    default = await _ensure_default_portfolio(db)
    return default.id


# ---------------------------------------------------------------------------
# 탭 관리
# ---------------------------------------------------------------------------

@router.get("/portfolios", response_model=List[PortfolioOut])
async def list_portfolios(
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """탭 목록 조회. 하나도 없으면 기본 탭을 만들어 반환한다."""
    portfolios = await _list_portfolios(db)
    if not portfolios:
        await _ensure_default_portfolio(db)
        portfolios = await _list_portfolios(db)
    return portfolios


@router.post("/portfolios", response_model=PortfolioOut)
async def create_portfolio(
    body: PortfolioCreateBody,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """탭 추가 (최대 MAX_PORTFOLIOS개)."""
    count = await db.scalar(select(func.count()).select_from(RecommendedPortfolio))
    if (count or 0) >= MAX_PORTFOLIOS:
        raise HTTPException(
            status_code=400,
            detail=f"추천 포트폴리오는 최대 {MAX_PORTFOLIOS}개까지 만들 수 있습니다.",
        )

    max_seq = await db.scalar(select(func.max(RecommendedPortfolio.seq)))
    portfolio = RecommendedPortfolio(
        id=str(uuid.uuid4()),
        name=(body.name or "").strip() or f"포트폴리오 {(count or 0) + 1}",
        seq=(max_seq or 0) + 1,
        account_type="pension",
    )
    db.add(portfolio)
    await db.commit()
    await db.refresh(portfolio)
    return portfolio


@router.patch("/portfolios/{portfolio_id}", response_model=PortfolioOut)
async def update_portfolio(
    portfolio_id: str,
    body: PortfolioUpdateBody,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """탭 이름·화면 설정 변경."""
    portfolio = await _get_portfolio_or_404(portfolio_id, db)
    if body.name is not None:
        name = body.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="이름은 비워 둘 수 없습니다.")
        portfolio.name = name[:100]
    if body.account_type is not None:
        portfolio.account_type = body.account_type
    if body.monthly_amount is not None:
        portfolio.monthly_amount = body.monthly_amount
    if body.lump_sum_amount is not None:
        portfolio.lump_sum_amount = body.lump_sum_amount
    await db.commit()
    await db.refresh(portfolio)
    return portfolio


@router.delete("/portfolios/{portfolio_id}")
async def delete_portfolio(
    portfolio_id: str,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """탭 삭제 (담긴 상품도 함께 삭제). 마지막 한 개는 지울 수 없다."""
    await _get_portfolio_or_404(portfolio_id, db)
    count = await db.scalar(select(func.count()).select_from(RecommendedPortfolio))
    if (count or 0) <= 1:
        raise HTTPException(
            status_code=400, detail="마지막 추천 포트폴리오는 삭제할 수 없습니다."
        )

    await db.execute(
        delete(RecommendedPortfolioItem).where(
            RecommendedPortfolioItem.portfolio_id == portfolio_id
        )
    )
    await db.execute(
        delete(RecommendedPortfolio).where(RecommendedPortfolio.id == portfolio_id)
    )
    await db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# 상품 목록
# ---------------------------------------------------------------------------

@router.get("", response_model=List[RecommendedPortfolioItemOut])
async def get_recommended_portfolio(
    portfolio_id: Optional[str] = Query(None),
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """특정 탭의 상품 목록 조회 (seq 순 정렬)."""
    pid = await _resolve_portfolio_id(portfolio_id, db)
    return await _items_of(pid, db)


@router.put("", response_model=List[RecommendedPortfolioItemOut])
async def save_recommended_portfolio(
    body: RecommendedPortfolioSaveBody,
    portfolio_id: Optional[str] = Query(None),
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """특정 탭의 상품 목록 저장 (해당 탭 데이터만 삭제 후 새로 삽입)."""
    pid = await _resolve_portfolio_id(portfolio_id, db)

    # 해당 탭 데이터만 삭제 — 다른 탭을 건드리지 않는다
    await db.execute(
        delete(RecommendedPortfolioItem).where(
            RecommendedPortfolioItem.portfolio_id == pid
        )
    )

    for item_in in body.items:
        db.add(
            RecommendedPortfolioItem(
                id=str(uuid.uuid4()),
                portfolio_id=pid,
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
        )

    # 화면 설정도 함께 기억한다
    if body.account_type is not None or body.monthly_amount is not None or body.lump_sum_amount is not None:
        portfolio = await _get_portfolio_or_404(pid, db)
        if body.account_type is not None:
            portfolio.account_type = body.account_type
        if body.monthly_amount is not None:
            portfolio.monthly_amount = body.monthly_amount
        if body.lump_sum_amount is not None:
            portfolio.lump_sum_amount = body.lump_sum_amount

    await db.commit()
    return await _items_of(pid, db)


@router.post("/refresh-prices", response_model=List[RecommendedPortfolioItemOut])
async def refresh_prices(
    portfolio_id: Optional[str] = Query(None),
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """해당 탭에서 종목코드가 있는 ETF/주식 항목의 현재가를 갱신.

    product_type이 '펀드'인 항목은 스킵합니다.
    """
    pid = await _resolve_portfolio_id(portfolio_id, db)
    items = await _items_of(pid, db)

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
    return await _items_of(pid, db)
