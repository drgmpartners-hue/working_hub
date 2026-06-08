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


# ---------------------------------------------------------------------------
# Theme population (테마 반영)
# ---------------------------------------------------------------------------
# ⚠️ 외부 API 미연동 상태의 큐레이션 mock 테마.
#    실데이터: 네이버 금융 테마 + ETF 구성종목 역설계 + 뉴스 공출현(08-stock-etf §5)으로 교체 예정.
# ⚠️ ai_score(좋은 테마 판단 점수) 산정 로직은 사용자 제공 자료로 확정 예정 — 현재 결정적 placeholder 값.
_MOCK_THEMES = [
    {"theme_name": "AI반도체·HBM", "ai_score": 94.2, "stock_count": 12,
     "news_summary": "HBM 수요 급증과 AI 가속기 투자 확대로 메모리·후공정 밸류체인 전반에 모멘텀이 집중되고 있습니다."},
    {"theme_name": "원자력·SMR", "ai_score": 88.7, "stock_count": 9,
     "news_summary": "글로벌 전력수요 증가와 SMR 정책 지원으로 원전 기자재·EPC 기업 수주 기대가 확대되고 있습니다."},
    {"theme_name": "방산", "ai_score": 86.1, "stock_count": 8,
     "news_summary": "지정학 리스크 지속과 수출 호조로 방산 대형주 중심의 실적 가시성이 높습니다."},
    {"theme_name": "로봇", "ai_score": 82.4, "stock_count": 10,
     "news_summary": "휴머노이드·협동로봇 상용화 기대와 대기업 투자로 부품·솔루션 기업이 주목받고 있습니다."},
    {"theme_name": "조선", "ai_score": 79.8, "stock_count": 7,
     "news_summary": "친환경 선박 발주 사이클과 선가 상승으로 조선·기자재 업황이 개선되고 있습니다."},
    {"theme_name": "전력기기·전력망", "ai_score": 77.3, "stock_count": 9,
     "news_summary": "AI 데이터센터·전력망 노후 교체 수요로 변압기·전선 기업 수출이 증가하고 있습니다."},
    {"theme_name": "2차전지", "ai_score": 68.5, "stock_count": 15,
     "news_summary": "전기차 수요 둔화 우려가 있으나 ESS·소재 다변화로 중장기 성장성은 유효합니다."},
    {"theme_name": "바이오·제약", "ai_score": 65.9, "stock_count": 14,
     "news_summary": "신약 임상 모멘텀과 위탁생산(CDMO) 수주로 선별적 강세가 나타나고 있습니다."},
    {"theme_name": "우주항공·UAM", "ai_score": 63.2, "stock_count": 6,
     "news_summary": "발사체·위성·도심항공 정책 로드맵으로 장기 테마이나 실적 가시성은 제한적입니다."},
    {"theme_name": "엔터·미디어", "ai_score": 58.6, "stock_count": 8,
     "news_summary": "아티스트 활동 재개와 콘텐츠 수출 회복으로 실적 반등 기대가 형성되고 있습니다."},
    {"theme_name": "자동차부품", "ai_score": 55.1, "stock_count": 11,
     "news_summary": "완성차 판매 둔화와 전동화 전환 비용 부담으로 종목별 차별화가 큰 구간입니다."},
    {"theme_name": "화장품·뷰티", "ai_score": 52.4, "stock_count": 9,
     "news_summary": "수출 다변화와 인디브랜드 성장으로 일부 ODM·브랜드사가 강세를 보입니다."},
]


async def populate_themes(db: AsyncSession) -> list[StockTheme]:
    """큐레이션 mock 테마를 stock_themes 테이블에 반영(upsert, 멱등).

    이미 존재하는 theme_name은 건너뜀 → 버튼 반복 클릭에도 중복 생성 안 됨.
    ⚠️ 실데이터 연동 시 _MOCK_THEMES 대신 네이버/ETF/뉴스 수집 결과로 교체.
    """
    result = await db.execute(select(StockTheme))
    existing = {t.theme_name for t in result.scalars().all()}
    created: list[StockTheme] = []
    for data in _MOCK_THEMES:
        if data["theme_name"] in existing:
            continue
        theme = StockTheme(
            theme_name=data["theme_name"],
            ai_score=data["ai_score"],
            news_summary=data["news_summary"],
            stock_count=data["stock_count"],
        )
        db.add(theme)
        created.append(theme)
    if created:
        await db.commit()
        for theme in created:
            await db.refresh(theme)
    return await get_themes(db)


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
