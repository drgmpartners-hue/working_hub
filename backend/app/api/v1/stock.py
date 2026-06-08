"""Stock theme, recommendation, recommended stock, and company stock pool endpoints."""
from typing import Annotated, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
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
    ScreeningItemResponse,
    PerformanceItemResponse,
    PerformanceSummaryResponse,
)
from app.services import stock_service
from app.services import stock_advanced_service  # noqa: F401 (used below)

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
    "/themes/refresh",
    response_model=list[StockThemeResponse],
    summary="Populate stock themes from source (mock — curated list)",
)
async def refresh_themes(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[StockThemeResponse]:
    """테마 목록을 소스에서 반영(upsert, 멱등).

    현재는 큐레이션 mock 테마. 추후 네이버 금융 테마 + ETF 구성종목 역설계 +
    뉴스 공출현(08-stock-etf §5)으로 교체.
    """
    themes = await stock_service.populate_themes(db)
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


# ---------------------------------------------------------------------------
# P5-R4: Stock Screening (mock)
# ---------------------------------------------------------------------------


@router.get(
    "/screening",
    response_model=list[ScreeningItemResponse],
    summary="[P5-R4] 종목 스크리닝 (mock)",
)
async def screen_stocks(
    current_user: CurrentUser,
    pbr_max: Optional[float] = Query(default=None, description="PBR 최댓값 필터"),
    ma_alignment: Optional[str] = Query(
        default=None, description="이동평균 정렬: bullish|bearish|mixed"
    ),
    score_min: Optional[float] = Query(default=None, description="종합점수 최솟값 필터"),
) -> list[ScreeningItemResponse]:
    """
    mock 풀에서 쿼리 파라미터로 필터링한 종목 리스트 반환.
    ⚠️ 산정 로직 사용자 자료 대기 — placeholder (결정적 hash-mock).
    """
    return stock_advanced_service.get_screening(
        pbr_max=pbr_max,
        ma_alignment=ma_alignment,
        score_min=score_min,
    )


# ---------------------------------------------------------------------------
# P5-R6: Recommendation Performance (mock)
# ---------------------------------------------------------------------------


@router.get(
    "/performance/summary",
    response_model=PerformanceSummaryResponse,
    summary="[P5-R6] 추천 사후성과 요약 (mock)",
)
async def get_performance_summary(
    current_user: CurrentUser,
) -> PerformanceSummaryResponse:
    """
    전체 추천 종목 사후성과 요약 지표 반환.
    ⚠️ 산정 로직 사용자 자료 대기 — placeholder (결정적 hash-mock).
    """
    return stock_advanced_service.get_performance_summary()


@router.get(
    "/performance",
    response_model=list[PerformanceItemResponse],
    summary="[P5-R6] 추천 사후성과 리스트 (mock)",
)
async def get_performance(
    current_user: CurrentUser,
    theme: Optional[str] = Query(default=None, description="테마 필터"),
    status_filter: Optional[str] = Query(
        default=None, alias="status", description="상태 필터: hit|miss|holding"
    ),
    period: Optional[str] = Query(default=None, description="보유 기간 필터: 1m|3m|6m|1y|3y"),
) -> list[PerformanceItemResponse]:
    """
    추천 종목 사후성과 리스트 반환. theme/status/period 필터 지원.
    ⚠️ 산정 로직 사용자 자료 대기 — placeholder (결정적 hash-mock).
    """
    return stock_advanced_service.get_performance(
        theme=theme,
        status=status_filter,
        period=period,
    )
