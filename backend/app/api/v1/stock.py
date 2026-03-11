"""Stock theme, recommendation, recommended stock, and company stock pool endpoints."""
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.deps import CurrentUser
from app.db.session import get_db
from app.schemas.stock import (
    StockThemeResponse,
    StockThemeAnalyzeRequest,
    StockRecommendationCreate,
    StockRecommendationResponse,
    RecommendedStockResponse,
    CompanyStockPoolCreate,
    CompanyStockPoolResponse,
)
from app.services import stock_service

router = APIRouter(prefix="/stocks", tags=["stocks"])


# ---------------------------------------------------------------------------
# Stock Themes
# ---------------------------------------------------------------------------


@router.get(
    "/themes",
    response_model=list[StockThemeResponse],
    summary="List all stock themes",
)
async def list_themes(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[StockThemeResponse]:
    """Return all available stock themes."""
    themes = await stock_service.get_themes(db)
    return [StockThemeResponse.model_validate(t) for t in themes]


@router.post(
    "/themes/analyze",
    response_model=list[StockThemeResponse],
    summary="Analyze selected stock themes (mock AI)",
)
async def analyze_themes(
    body: StockThemeAnalyzeRequest,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[StockThemeResponse]:
    """Run mock AI analysis on the given theme IDs, updating their ai_score and news_summary."""
    if not body.theme_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="theme_ids must not be empty.",
        )
    themes = await stock_service.analyze_themes(db, body.theme_ids)
    return [StockThemeResponse.model_validate(t) for t in themes]


# ---------------------------------------------------------------------------
# Stock Recommendations
# ---------------------------------------------------------------------------


@router.post(
    "/recommendations",
    response_model=StockRecommendationResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a stock recommendation",
)
async def create_recommendation(
    body: StockRecommendationCreate,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> StockRecommendationResponse:
    """Create a new stock recommendation with mock AI-generated scores."""
    recommendation = await stock_service.create_recommendation(
        db, current_user.id, body
    )
    return StockRecommendationResponse.model_validate(recommendation)


@router.get(
    "/recommendations/{recommendation_id}",
    response_model=StockRecommendationResponse,
    summary="Get stock recommendation detail",
)
async def get_recommendation(
    recommendation_id: str,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> StockRecommendationResponse:
    """Return a single stock recommendation owned by the authenticated user."""
    recommendation = await stock_service.get_recommendation(
        db, current_user.id, recommendation_id
    )
    if recommendation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Stock recommendation '{recommendation_id}' not found.",
        )
    return StockRecommendationResponse.model_validate(recommendation)


# ---------------------------------------------------------------------------
# Recommended Stocks
# ---------------------------------------------------------------------------


@router.get(
    "/recommendations/{recommendation_id}/stocks",
    response_model=list[RecommendedStockResponse],
    summary="List recommended stocks",
)
async def list_recommended_stocks(
    recommendation_id: str,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[RecommendedStockResponse]:
    """Return all recommended stocks for a given recommendation.

    The recommendation must belong to the authenticated user.
    """
    recommendation = await stock_service.get_recommendation(
        db, current_user.id, recommendation_id
    )
    if recommendation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Stock recommendation '{recommendation_id}' not found.",
        )
    stocks = await stock_service.get_recommended_stocks(db, recommendation_id)
    return [RecommendedStockResponse.model_validate(s) for s in stocks]


# ---------------------------------------------------------------------------
# Company Stock Pool
# ---------------------------------------------------------------------------


@router.get(
    "/pool",
    response_model=list[CompanyStockPoolResponse],
    summary="List company stock pools",
)
async def list_stock_pool(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[CompanyStockPoolResponse]:
    """Return all company stock pool entries."""
    pools = await stock_service.get_stock_pool(db)
    return [CompanyStockPoolResponse.model_validate(p) for p in pools]


@router.post(
    "/pool",
    response_model=CompanyStockPoolResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Add a company stock pool entry",
)
async def add_to_stock_pool(
    body: CompanyStockPoolCreate,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> CompanyStockPoolResponse:
    """Create a new company stock pool entry."""
    pool = await stock_service.add_to_pool(db, body)
    return CompanyStockPoolResponse.model_validate(pool)
