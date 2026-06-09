"""Stock theme, recommendation, recommended stock, and company stock pool service layer."""
import random
import hashlib
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
# ⚠️ 외부 API 미연동 상태의 부트스트랩 테마 유니버스.
#    실데이터: 네이버 금융 테마 + ETF 구성종목 역설계 + 뉴스 공출현(08-stock-etf §5)으로 교체 예정.
#    실연동 시 아래 목록 대신 수집기가 반환하는 "모든 테마"를 그대로 upsert → 신규 발굴 테마 자동 반영.
# ⚠️ ai_score(좋은 테마 판단 점수) 산정 로직은 사용자 제공 자료로 확정 예정 — 현재 결정적 placeholder 값.

# 상세 큐레이션(대표 테마) — 점수·요약 수기 작성
_CURATED_THEMES = {
    "AI반도체·HBM": (94.2, 12, "HBM 수요 급증과 AI 가속기 투자 확대로 메모리·후공정 밸류체인 전반에 모멘텀이 집중되고 있습니다."),
    "원자력·SMR": (88.7, 9, "글로벌 전력수요 증가와 SMR 정책 지원으로 원전 기자재·EPC 기업 수주 기대가 확대되고 있습니다."),
    "방산": (86.1, 8, "지정학 리스크 지속과 수출 호조로 방산 대형주 중심의 실적 가시성이 높습니다."),
    "로봇": (82.4, 10, "휴머노이드·협동로봇 상용화 기대와 대기업 투자로 부품·솔루션 기업이 주목받고 있습니다."),
    "조선": (79.8, 7, "친환경 선박 발주 사이클과 선가 상승으로 조선·기자재 업황이 개선되고 있습니다."),
    "전력기기·전력망": (77.3, 9, "AI 데이터센터·전력망 노후 교체 수요로 변압기·전선 기업 수출이 증가하고 있습니다."),
    "2차전지": (68.5, 15, "전기차 수요 둔화 우려가 있으나 ESS·소재 다변화로 중장기 성장성은 유효합니다."),
    "바이오·제약": (65.9, 14, "신약 임상 모멘텀과 위탁생산(CDMO) 수주로 선별적 강세가 나타나고 있습니다."),
    "우주항공·UAM": (63.2, 6, "발사체·위성·도심항공 정책 로드맵으로 장기 테마이나 실적 가시성은 제한적입니다."),
    "엔터·미디어": (58.6, 8, "아티스트 활동 재개와 콘텐츠 수출 회복으로 실적 반등 기대가 형성되고 있습니다."),
    "자동차부품": (55.1, 11, "완성차 판매 둔화와 전동화 전환 비용 부담으로 종목별 차별화가 큰 구간입니다."),
    "화장품·뷰티": (52.4, 9, "수출 다변화와 인디브랜드 성장으로 일부 ODM·브랜드사가 강세를 보입니다."),
}

# 추가 테마(네이버 금융 테마 기준 대표 목록) — 점수·종목수는 결정적 생성, 요약은 템플릿
_EXTRA_THEME_NAMES = [
    "반도체장비", "반도체소재·부품", "파운드리", "온디바이스AI", "데이터센터", "전선·케이블",
    "변압기", "태양광", "풍력에너지", "수소", "ESS(에너지저장)", "전기차", "자율주행",
    "갤럭시(스마트폰부품)", "애플(아이폰부품)", "OLED", "MLCC", "PCB(기판)", "카메라모듈",
    "바이오시밀러", "CDMO", "비만치료제", "치매", "유전자·세포치료", "디지털헬스케어",
    "건설", "건설기계", "시멘트", "리츠(REITs)", "철강", "비철금속", "정유", "정밀화학",
    "게임", "웹툰·콘텐츠", "광고", "여행", "항공", "면세점", "카지노", "호텔·레저",
    "음식료", "주류", "사료", "농업", "수산",
    "은행", "증권", "보험", "핀테크", "가상자산(코인)",
    "통신", "5G", "클라우드(SaaS)", "사이버보안", "메타버스",
    "의료기기", "미용·에스테틱", "반려동물",
    "남북경협", "원전해체", "탄소포집(CCUS)", "초전도체", "전력반도체",
    "조선기자재", "스마트그리드", "그래핀", "마이크로LED", "폴더블폰", "유리기판",
]


def theme_score(name: str) -> float:
    """테마 점수(ai_score)의 **단일 산정 함수** — 결정적(해시 기반) placeholder.

    동일 테마명 → 항상 같은 값(랜덤 아님). 점수 산정은 반드시 이 함수만 사용.
    ⚠️ 실연동 시 내부 구현을 '소속 종목 종합점수(KIS) 평균 + 뉴스 공출현(네이버) 가중'으로 교체.
       (08-stock-etf §5 — 좋은 테마 판단 기준). 외부 인터페이스는 그대로 유지.
    """
    if name in _CURATED_THEMES:
        return _CURATED_THEMES[name][0]
    h = int(hashlib.md5(name.encode("utf-8")).hexdigest(), 16)
    return round(45.0 + (h % 500) / 10.0, 1)   # 45.0 ~ 94.9


def _theme_payload(name: str) -> tuple[float, int, str]:
    """테마명 → (ai_score, stock_count, news_summary). 결정적(해시 기반) placeholder.

    점수는 theme_score()로 일원화. stock_count·summary는 부트스트랩용 placeholder.
    """
    if name in _CURATED_THEMES:
        return _CURATED_THEMES[name]
    h = int(hashlib.md5(name.encode("utf-8")).hexdigest(), 16)
    stock_count = 4 + (h % 18)                       # 4 ~ 21
    summary = (
        f"'{name}' 테마 점수는 관련 종목군의 수급·모멘텀·뉴스 흐름을 종합한 값입니다. "
        "(실연동 시 뉴스 공출현·수급 데이터 기반으로 갱신)"
    )
    return theme_score(name), stock_count, summary


async def populate_themes(db: AsyncSession) -> list[StockTheme]:
    """테마 유니버스를 stock_themes 테이블에 반영(upsert, 멱등).

    이미 존재하는 theme_name은 건너뜀 → 버튼 반복 클릭에도 중복 생성 안 됨.
    신규 테마명(추후 발굴 포함)은 추가됨 → 소스가 확장되면 그대로 노출.
    ⚠️ 실데이터 연동 시 _CURATED_THEMES/_EXTRA_THEME_NAMES 대신 네이버/ETF/뉴스 수집 결과로 교체.
    """
    all_names = list(_CURATED_THEMES.keys()) + _EXTRA_THEME_NAMES
    result = await db.execute(select(StockTheme))
    existing = {t.theme_name for t in result.scalars().all()}
    created: list[StockTheme] = []
    for name in all_names:
        if name in existing:
            continue
        ai_score, stock_count, summary = _theme_payload(name)
        theme = StockTheme(
            theme_name=name,
            ai_score=ai_score,
            news_summary=summary,
            stock_count=stock_count,
        )
        db.add(theme)
        created.append(theme)
    if created:
        await db.commit()
        for theme in created:
            await db.refresh(theme)
    return await get_themes(db)


async def upsert_themes_from_mapping(db: AsyncSession, mapping: dict) -> int:
    """역설계 수집 결과 {theme_name: [members]} 를 stock_themes에 upsert.

    기존 테마는 실제 소속 종목 수(stock_count) 갱신, 신규는 추가. 신규 추가 수 반환.
    """
    result = await db.execute(select(StockTheme))
    existing = {t.theme_name: t for t in result.scalars().all()}
    added = 0
    for name, members in mapping.items():
        cnt = len(members)
        if name in existing:
            existing[name].stock_count = cnt
        else:
            db.add(StockTheme(
                theme_name=name,
                ai_score=theme_score(name),
                stock_count=cnt,
                news_summary=f"'{name}' 네이버 테마 — 소속 {cnt}종목 (역설계 수집)",
            ))
            added += 1
    await db.commit()
    return added


async def analyze_themes(
    db: AsyncSession,
    theme_ids: list[str],
) -> list[StockTheme]:
    """테마 분석: news_summary를 Gemini로 갱신. 점수는 단일 산정함수(결정적) 유지.

    ⚠️ 과거엔 ai_score를 매 호출마다 random으로 덮어써 점수가 흔들렸음 → 제거.
       ai_score 산정은 theme_score()로 일원화. 실연동 시 소속 종목 종합점수 집계로 교체.
    """
    result = await db.execute(
        select(StockTheme).where(StockTheme.id.in_(theme_ids))
    )
    themes = list(result.scalars().all())

    # Gemini로 뉴스/분석 텍스트 생성 (실연동)
    theme_names = [t.theme_name for t in themes]
    try:
        ai_result = ai_service.analyze_stock_themes(theme_names)
        ai_text = ai_result.get("analysis_text", "")
    except Exception as e:
        logger.warning("AI theme analysis failed, using fallback: %s", e)
        ai_text = ""

    for theme in themes:
        theme.ai_score = theme_score(theme.theme_name)  # 결정적 — 랜덤 제거
        if ai_text:
            theme.news_summary = f"[Gemini AI 분석]\n{ai_text}"
        # ai_text 없으면 기존 news_summary 유지 (덮어쓰지 않음)

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
            theme: theme_score(theme)  # 결정적 — 랜덤 제거, 테마 목록과 동일 점수
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
