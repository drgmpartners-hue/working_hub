"""Stock theme, recommendation, recommended stock, and company stock pool schemas."""
from datetime import datetime
from typing import Any, Literal, Optional
from pydantic import BaseModel, field_validator


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


class ThemeCollectResponse(BaseModel):
    """테마-종목 매핑 역설계 수집 결과."""
    collected_themes: int
    new_themes: int
    total_members: int
    data_source: str = "naver"


class CalibrationReportResponse(BaseModel):
    """사후검증 가중치 보정 리포트."""
    sample_codes: int
    pairs: int
    horizon: int = 20
    r_momentum: Optional[float] = None   # 모멘텀↔이후수익 상관계수
    momentum_factor: float               # 모멘텀 가중치 배수
    current_weights: dict[str, dict[str, float]]
    proposed_weights: dict[str, dict[str, float]]
    matured_snapshots: int = 0
    snapshot_correlations: dict[str, float] = {}
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
    phase: Optional[str] = None  # breakout/turnaround/neutral
    updated_at: datetime
    # 네이버 테마 시세 흐름/국면
    interest_score: Optional[float] = None
    attention_phase: Optional[str] = None  # surge/emerging/hot/fading/quiet
    change_rate: Optional[float] = None
    up_count: Optional[int] = None
    down_count: Optional[int] = None
    basis_date: Optional[str] = None

    model_config = {"from_attributes": True}

    @field_validator("basis_date", mode="before")
    @classmethod
    def _date_to_str(cls, v):
        return str(v) if v is not None else None


class ThemeFlowPoint(BaseModel):
    date: str
    change_rate: Optional[float] = None


class ThemeAnalysisResponse(BaseModel):
    """분석 클릭 — 이미 읽어온(DB) 데이터만. KIS/추가 조회 없음."""
    theme_id: str
    theme_name: str
    attention_phase: Optional[str] = None
    interest_score: Optional[float] = None
    change_rate: Optional[float] = None
    up_count: Optional[int] = None
    down_count: Optional[int] = None
    basis_date: Optional[str] = None
    reason: Optional[str] = None              # 국면/점수 근거
    flow: list[ThemeFlowPoint] = []           # 누적 스냅샷(미니 흐름)
    members: list[dict] = []                  # 소속 종목(theme_members)
    score_detail: Optional[dict] = None       # 배치가 저장한 5축(있으면)


class ThemeReportResponse(BaseModel):
    """보고서 — 온디맨드 깊은 분석(멤버 과거시세 재구성 + 뉴스). 그 테마 1개만 조회."""
    theme_id: str
    theme_name: str
    attention_phase: Optional[str] = None
    interest_score: Optional[float] = None
    change_rate: Optional[float] = None
    basis_date: Optional[str] = None
    period: str = "3m"                        # 1w/1m/3m/6m/1y
    index_chart: list[dict] = []              # 테마 지수 누적수익률 [{date,value}]
    period_return: Optional[float] = None     # 기간 수익률(%)
    score_reason: str = ""                    # 왜 이 점수
    badge_reason: str = ""                    # 왜 이 뱃지
    members: list[dict] = []                  # 종목 + 기간수익률
    news: list[dict] = []                     # 대표기사
    news_count: int = 0
    conclusion: str = ""                      # 담기 판단(쉽게 풀어쓴)
    data_source: str = "live"


class ReportSettingsResponse(BaseModel):
    email_enabled: bool
    recipient: Optional[str] = None


class SystemStatusResponse(BaseModel):
    """데이터 신선도/현황 — 화면에서 마지막 갱신 확인용."""
    server_started_at: str           # 백엔드 프로세스 시작(≈ 마지막 배포)
    last_batch_at: Optional[str] = None     # 마지막 배치(데이터 갱신) 완료 시각
    last_data_date: Optional[str] = None    # 적재된 종목 지표 최신 거래일
    theme_count: int = 0
    scored_theme_count: int = 0      # 5축 점수가 계산된 테마 수
    metric_count: int = 0            # 최신일 지표 적재 종목 수


class ReportSettingsUpdate(BaseModel):
    email_enabled: bool
    recipient: Optional[str] = None


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
