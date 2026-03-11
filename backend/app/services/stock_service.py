"""Stock theme, recommendation, recommended stock, and company stock pool service layer."""
import random
import logging
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.stock import (
    StockTheme,
    StockRecommendation,
    RecommendedStock,
    CompanyStockPool,
)
from app.schemas.stock import (
    StockRecommendationCreate,
    CompanyStockPoolCreate,
)
from app.services import ai_service

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Mock data for AI-generated recommended stocks
# ---------------------------------------------------------------------------

_MOCK_STOCK_POOL = [
    {"code": "005930", "name": "삼성전자"},
    {"code": "000660", "name": "SK하이닉스"},
    {"code": "035720", "name": "카카오"},
    {"code": "035420", "name": "NAVER"},
    {"code": "051910", "name": "LG화학"},
    {"code": "006400", "name": "삼성SDI"},
    {"code": "207940", "name": "삼성바이오로직스"},
    {"code": "068270", "name": "셀트리온"},
    {"code": "028260", "name": "삼성물산"},
    {"code": "012330", "name": "현대모비스"},
]


def _generate_mock_stocks(
    recommendation_id: str,
    selected_themes: dict,
) -> list[RecommendedStock]:
    """Generate placeholder recommended stocks based on selected themes."""
    stocks: list[RecommendedStock] = []
    rank = 1

    theme_names = list(selected_themes.keys()) if selected_themes else ["기본 테마"]
    mock_pool = _MOCK_STOCK_POOL.copy()
    random.shuffle(mock_pool)

    for i, stock_info in enumerate(mock_pool[:10]):
        theme = theme_names[i % len(theme_names)]
        is_top5 = rank <= 5
        stocks.append(
            RecommendedStock(
                recommendation_id=recommendation_id,
                stock_code=stock_info["code"],
                stock_name=stock_info["name"],
                theme=theme,
                rank=rank,
                return_1m=round(random.uniform(-5.0, 15.0), 2),
                return_3m=round(random.uniform(-10.0, 30.0), 2),
                return_6m=round(random.uniform(-15.0, 50.0), 2),
                institutional_buy=round(random.uniform(0.0, 100.0), 2),
                foreign_buy=round(random.uniform(0.0, 100.0), 2),
                is_top5=is_top5,
                analysis_report=(
                    f"[AI 분석 리포트 - Mock] {stock_info['name']} ({stock_info['code']}): "
                    f"테마 '{theme}'에서 주목할 만한 종목입니다. "
                    "기관 및 외국인 매수세가 꾸준히 유입되고 있으며 단기 수익률이 양호합니다."
                ) if is_top5 else None,
            )
        )
        rank += 1

    return stocks


# ---------------------------------------------------------------------------
# Theme operations
# ---------------------------------------------------------------------------


async def get_themes(db: AsyncSession) -> list[StockTheme]:
    """Return all stock themes ordered by theme name."""
    result = await db.execute(
        select(StockTheme).order_by(StockTheme.theme_name)
    )
    return list(result.scalars().all())


async def analyze_themes(
    db: AsyncSession,
    theme_ids: list[str],
) -> list[StockTheme]:
    """Mock AI analysis: update ai_score and news_summary for the given themes."""
    result = await db.execute(
        select(StockTheme).where(StockTheme.id.in_(theme_ids))
    )
    themes = list(result.scalars().all())

    # Call Gemini for real analysis
    theme_names = [t.theme_name for t in themes]
    try:
        ai_result = ai_service.analyze_stock_themes(theme_names)
        ai_text = ai_result.get("analysis_text", "")
    except Exception as e:
        logger.warning("AI theme analysis failed, using fallback: %s", e)
        ai_text = ""

    for theme in themes:
        theme.ai_score = round(random.uniform(50.0, 99.9), 1)
        if ai_text:
            theme.news_summary = f"[Gemini AI 분석]\n{ai_text}"
        else:
            theme.news_summary = (
                f"'{theme.theme_name}' 테마는 최근 긍정적인 뉴스 흐름을 "
                "보이고 있습니다. 관련 산업의 성장세가 지속되며 투자 매력도가 높아지고 있습니다."
            )

    await db.commit()
    for theme in themes:
        await db.refresh(theme)

    return themes


# ---------------------------------------------------------------------------
# Recommendation operations
# ---------------------------------------------------------------------------


async def create_recommendation(
    db: AsyncSession,
    user_id: str,
    data: StockRecommendationCreate,
) -> StockRecommendation:
    """Create a recommendation record and generate placeholder recommended stocks."""
    recommendation = StockRecommendation(
        user_id=user_id,
        selected_themes=data.selected_themes,
        ai_scores={
            theme: round(random.uniform(50.0, 99.9), 1)
            for theme in data.selected_themes.keys()
        },
        status="completed",
    )
    db.add(recommendation)
    await db.flush()  # populate recommendation.id before creating children

    mock_stocks = _generate_mock_stocks(recommendation.id, data.selected_themes)
    for stock in mock_stocks:
        db.add(stock)

    await db.commit()
    await db.refresh(recommendation)
    return recommendation


async def get_recommendation(
    db: AsyncSession,
    user_id: str,
    recommendation_id: str,
) -> Optional[StockRecommendation]:
    """Return a single recommendation owned by the given user, or None."""
    result = await db.execute(
        select(StockRecommendation).where(
            StockRecommendation.id == recommendation_id,
            StockRecommendation.user_id == user_id,
        )
    )
    return result.scalar_one_or_none()


async def get_recommended_stocks(
    db: AsyncSession,
    recommendation_id: str,
) -> list[RecommendedStock]:
    """Return all recommended stocks for the given recommendation, ordered by rank."""
    result = await db.execute(
        select(RecommendedStock)
        .where(RecommendedStock.recommendation_id == recommendation_id)
        .order_by(RecommendedStock.rank)
    )
    return list(result.scalars().all())


# ---------------------------------------------------------------------------
# Company stock pool operations
# ---------------------------------------------------------------------------


async def get_stock_pool(db: AsyncSession) -> list[CompanyStockPool]:
    """Return all company stock pool entries ordered by creation date."""
    result = await db.execute(
        select(CompanyStockPool).order_by(CompanyStockPool.created_at.desc())
    )
    return list(result.scalars().all())


async def add_to_pool(
    db: AsyncSession,
    data: CompanyStockPoolCreate,
) -> CompanyStockPool:
    """Create a new company stock pool entry."""
    pool = CompanyStockPool(
        pool_name=data.pool_name,
        stocks=data.stocks,
    )
    db.add(pool)
    await db.commit()
    await db.refresh(pool)
    return pool
