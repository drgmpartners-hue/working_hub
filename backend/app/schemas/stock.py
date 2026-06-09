"""Stock theme, recommendation, recommended stock, and company stock pool schemas."""
from datetime import datetime
from typing import Any, Literal, Optional
from pydantic import BaseModel


# ---------------------------------------------------------------------------
# P5-R3: Market Signals
# ---------------------------------------------------------------------------

class DisparityResponse(BaseModel):
    ma20: float
    ma60: float


class SignalsBlock(BaseModel):
    golden_cross: bool
    dead_cross: bool
    ma_alignment: Literal["bullish", "bearish", "mixed"]
    disparity: DisparityResponse


class ScoreBreakdown(BaseModel):
    valuation: float
    momentum: float
    supply: float


class MarketSignalsResponse(BaseModel):
    code: str
    ma5: float
    ma20: float
    ma60: float
    ma120: float
    signals: SignalsBlock
    composite_score: float  # 0~100
    score_breakdown: ScoreBreakdown
    roe: float
    phase: Literal["breakout", "turnaround", "neutral"] = "neutral"  # 국면: 고점돌파/바닥탈출/중립
    phase_reasons: list[str] = []  # 국면 판별 근거
    data_source: str = "mock"  # "kis"=실데이터 / "mock"=placeholder


# ---------------------------------------------------------------------------
# P5-R4: Stock Screening
# ---------------------------------------------------------------------------

class ScreeningItemResponse(BaseModel):
    stock_code: str
    stock_name: str
    theme: str
    pbr: float
    per: float
    composite_score: float
    signal_tags: list[str]
    ma_alignment: Literal["bullish", "bearish", "mixed"]
    return_1m: float
    return_3m: float
    return_6m: float
    is_top5: bool
    allocation_pct: float


# ---------------------------------------------------------------------------
# P5-R5: Backtest
# ---------------------------------------------------------------------------

class BacktestChartPoint(BaseModel):
    date: str
    value: float
    benchmark: float


class BacktestResponse(BaseModel):
    stock_code: str
    period: str
    entry_date: str
    entry_price: float
    current_price: float
    return_rate: float
    benchmark_return: float
    max_drawdown: float
    chart_data: list[BacktestChartPoint]
    data_source: str = "mock"  # "kis"=실데이터 / "mock"=placeholder


# ---------------------------------------------------------------------------
# P5-R1: Insights (네이버 뉴스 + DART 재무)
# ---------------------------------------------------------------------------

class NewsItem(BaseModel):
    title: str
    link: str
    description: str = ""
    pub_date: str = ""


class FinancialTrendPoint(BaseModel):
    period: str  # 전전기/전기/당기
    value: float


class StockInsightsResponse(BaseModel):
    code: str
    news: list[NewsItem] = []
    revenue_trend: list[FinancialTrendPoint] = []
    operating_profit_trend: list[FinancialTrendPoint] = []
    data_source: str = "mock"  # "live"=뉴스/재무 실데이터 / "mock"=키 미연동


# ---------------------------------------------------------------------------
# 테마 5축 집계 점수
# ---------------------------------------------------------------------------

class ThemeAxes(BaseModel):
    momentum: float       # 모멘텀
    supply: float         # 수급
    fundamentals: float   # 실적
    attention: float      # 관심도
    valuation: float      # 밸류(역방향)


class ThemeMemberScore(BaseModel):
    code: str
    phase: Literal["breakout", "turnaround", "neutral"]
    score: float


class ThemeScoreResponse(BaseModel):
    theme_id: str
    theme_name: str
    score: float
    phase: Literal["breakout", "turnaround", "neutral"]
    axes: ThemeAxes
    weights: dict[str, float]
    members: list[ThemeMemberScore] = []
    data_source: str = "mock"  # "live"=소속 종목 실데이터 집계 / "mock"=매핑·키 미연동


class CalibrationReportResponse(BaseModel):
    """사후검증 가중치 보정 리포트."""
    sample_codes: int
    pairs: int
    horizon: int = 20
    r_momentum: Optional[float] = None   # 모멘텀↔이후수익 상관계수
    momentum_factor: float               # 모멘텀 가중치 배수
    current_weights: dict[str, dict[str, float]]
    proposed_weights: dict[str, dict[str, float]]
    data_source: str
    note: str
    applied: bool = False


# ---------------------------------------------------------------------------
# P5-R6: Recommendation Performance
# ---------------------------------------------------------------------------

class PerformanceItemResponse(BaseModel):
    recommendation_id: str
    stock_code: str
    stock_name: str
    theme: str
    recommended_date: str
    recommended_price: float
    current_price: float
    return_since: float
    benchmark_return: float
    excess_return: float
    holding_days: int
    status: Literal["hit", "miss", "holding"]
    composite_score_at_rec: float


class StatusDistribution(BaseModel):
    hit: int
    miss: int
    holding: int


class PerformanceSummaryResponse(BaseModel):
    hit_rate: float
    avg_excess_return: float
    tracked_count: int
    avg_holding_days: float
    status_distribution: StatusDistribution


class StockThemeResponse(BaseModel):
    id: str
    theme_name: str
    ai_score: Optional[float] = None
    news_summary: Optional[str] = None
    stock_count: int
    updated_at: datetime

    model_config = {"from_attributes": True}


class StockThemeAnalyzeRequest(BaseModel):
    theme_ids: list[str]

    model_config = {"from_attributes": True}


class StockRecommendationCreate(BaseModel):
    selected_themes: dict[str, Any]

    model_config = {"from_attributes": True}


class StockRecommendationResponse(BaseModel):
    id: str
    user_id: str
    selected_themes: dict[str, Any]
    ai_scores: Optional[dict[str, Any]] = None
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


class RecommendedStockResponse(BaseModel):
    id: str
    recommendation_id: str
    stock_code: str
    stock_name: str
    theme: str
    rank: int
    return_1m: Optional[float] = None
    return_3m: Optional[float] = None
    return_6m: Optional[float] = None
    institutional_buy: Optional[float] = None
    foreign_buy: Optional[float] = None
    is_top5: bool
    analysis_report: Optional[str] = None

    model_config = {"from_attributes": True}


class CompanyStockPoolCreate(BaseModel):
    pool_name: str
    stocks: dict[str, Any]

    model_config = {"from_attributes": True}


class CompanyStockPoolResponse(BaseModel):
    id: str
    pool_name: str
    stocks: dict[str, Any]
    created_at: datetime

    model_config = {"from_attributes": True}
