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
    ThemeScoreResponse,
    ThemeAxes,
    CalibrationReportResponse,
    ThemeCollectResponse,
    ReportSettingsResponse,
    ReportSettingsUpdate,
    SystemStatusResponse,
)
from datetime import datetime, timezone
from fastapi.responses import HTMLResponse
from app.models.stock import StockTheme
from app.services import (
    stock_service, theme_scoring, weight_calibration, settings_store,
    stock_report, email_service,
)
from app.services.collectors import theme_mapping_collector
from app.core.config import settings as app_config
from app.services import stock_advanced_service  # noqa: F401 (used below)

router = APIRouter(prefix="/stocks", tags=["stocks"])

# 백엔드 프로세스 시작 시각(≈ 마지막 배포). 모듈 로드 시 1회 캡처.
_SERVER_STARTED_AT = datetime.now(timezone.utc).isoformat()


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
    "/themes/collect",
    response_model=ThemeCollectResponse,
    summary="테마-종목 매핑 역설계 수집 (네이버 금융 테마)",
)
async def collect_theme_mapping(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    max_pages: int = Query(default=7, ge=1, le=8, description="네이버 테마 목록 페이지 수(페이지당 ~40테마)"),
) -> ThemeCollectResponse:
    """네이버 금융 테마에서 테마+소속종목을 수집해 매핑 캐시 생성, DB 테마 upsert.

    이후 테마 5축 집계가 실제 소속 종목으로 동작한다.
    """
    mapping = await theme_mapping_collector.collect(max_pages=max_pages)
    added = await stock_service.upsert_themes_from_mapping(db, mapping)
    return ThemeCollectResponse(
        collected_themes=len(mapping),
        new_themes=added,
        total_members=sum(len(v) for v in mapping.values()),
    )


@router.get(
    "/themes/{theme_id}/score",
    response_model=ThemeScoreResponse,
    summary="테마 5축 집계 점수 (소속 종목 실데이터 + 국면 가중치 스위칭)",
)
async def get_theme_score(
    theme_id: str,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ThemeScoreResponse:
    """테마 점수를 소속 종목 실데이터로 5축 집계.

    모멘텀·수급·실적·관심도·밸류 5축 + 국면(고점돌파/바닥탈출)별 가중치 스위칭.
    매핑/키 없으면 placeholder(data_source=mock) 폴백. live 시 ai_score를 DB에 반영.
    """
    theme = await db.get(StockTheme, theme_id)
    if not theme:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="테마를 찾을 수 없습니다.")

    agg = await theme_scoring.aggregate_theme(db, current_user.id, theme.theme_name)
    if agg is None:
        # placeholder 폴백 — 기존 점수 유지, 5축은 0
        return ThemeScoreResponse(
            theme_id=theme_id,
            theme_name=theme.theme_name,
            score=theme.ai_score or stock_service.theme_score(theme.theme_name),
            phase="neutral",
            axes=ThemeAxes(momentum=0, supply=0, fundamentals=0, attention=0, valuation=0),
            weights=theme_scoring._WEIGHTS["neutral"],
            members=[],
            data_source="mock",
        )

    # 실데이터 집계 성공 → DB ai_score 갱신
    theme.ai_score = agg["score"]
    await db.commit()
    return ThemeScoreResponse(theme_id=theme_id, theme_name=theme.theme_name, **agg)


# ---------------------------------------------------------------------------
# 사후검증 가중치 보정
# ---------------------------------------------------------------------------

@router.get(
    "/calibration/report",
    response_model=CalibrationReportResponse,
    summary="가중치 보정 리포트 (모멘텀 예측력 역사적 백테스트)",
)
async def calibration_report(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    horizon: int = Query(default=20, ge=5, le=60, description="예측 검증 기간(거래일)"),
) -> CalibrationReportResponse:
    """과거 모멘텀 점수가 이후 horizon일 수익을 예측했는지 상관계수로 검증 → 제안 가중치."""
    report = await weight_calibration.run_calibration(db, current_user.id, horizon=horizon)
    return CalibrationReportResponse(**report, applied=False)


@router.post(
    "/calibration/apply",
    response_model=CalibrationReportResponse,
    summary="가중치 보정 적용 (제안 가중치를 영속화)",
)
async def calibration_apply(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    horizon: int = Query(default=20, ge=5, le=60),
) -> CalibrationReportResponse:
    """보정 리포트를 산출하고, 제안 가중치를 적용(영속화)하여 이후 테마 점수에 반영."""
    report = await weight_calibration.run_calibration(db, current_user.id, horizon=horizon)
    applied = False
    if report["data_source"] == "live":
        weight_calibration.apply_weights(report["proposed_weights"])
        applied = True
    return CalibrationReportResponse(**report, applied=applied)


# ---------------------------------------------------------------------------
# 일일 리포트 이메일 (설정 / 미리보기 / 발송)
# ---------------------------------------------------------------------------

@router.get("/report/settings", response_model=ReportSettingsResponse, summary="리포트 이메일 설정 조회")
async def get_report_settings(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ReportSettingsResponse:
    enabled = await settings_store.get_bool(db, settings_store.REPORT_EMAIL_ENABLED, default=False)
    # 기본 수신자 = 저장값 → 로그인 이메일 → STAFF_EMAIL 순
    recipient = (
        await settings_store.get(db, settings_store.REPORT_EMAIL_RECIPIENT)
        or getattr(current_user, "email", None)
        or app_config.STAFF_EMAIL
        or None
    )
    return ReportSettingsResponse(email_enabled=enabled, recipient=recipient)


@router.put("/report/settings", response_model=ReportSettingsResponse, summary="리포트 이메일 설정 변경(승인)")
async def update_report_settings(
    body: ReportSettingsUpdate,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ReportSettingsResponse:
    await settings_store.set_value(db, settings_store.REPORT_EMAIL_ENABLED, "1" if body.email_enabled else "0")
    if body.recipient is not None:
        await settings_store.set_value(db, settings_store.REPORT_EMAIL_RECIPIENT, body.recipient)
    recipient = await settings_store.get(db, settings_store.REPORT_EMAIL_RECIPIENT) or app_config.STAFF_EMAIL or None
    return ReportSettingsResponse(email_enabled=body.email_enabled, recipient=recipient)


@router.get("/report/preview", response_class=HTMLResponse, summary="리포트 미리보기(HTML)")
async def preview_report(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> HTMLResponse:
    html = await stock_report.build_report_html(db)
    return HTMLResponse(content=html)


@router.post("/report/send", response_model=ReportSettingsResponse, summary="리포트 지금 발송(수동 승인)")
async def send_report_now(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ReportSettingsResponse:
    recipient = await settings_store.get(db, settings_store.REPORT_EMAIL_RECIPIENT) or app_config.STAFF_EMAIL
    data = await stock_report.build_report_data(db)
    html = stock_report.render_html(data)
    await email_service.send_stock_report(recipient or "", html, data["date"])
    enabled = await settings_store.get_bool(db, settings_store.REPORT_EMAIL_ENABLED, default=False)
    return ReportSettingsResponse(email_enabled=enabled, recipient=recipient)


# ---------------------------------------------------------------------------
# 시스템 상태 (데이터 신선도)
# ---------------------------------------------------------------------------

@router.get("/status", response_model=SystemStatusResponse, summary="데이터 신선도/현황")
async def system_status(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SystemStatusResponse:
    """마지막 배치(데이터 갱신) 시각·적재 현황 — 화면에서 최신 여부 확인용."""
    from sqlalchemy import select as _sel, func as _f
    from app.models.stock_metrics import StockDailyMetric

    last_batch = await settings_store.get(db, "last_batch_at")
    last_date = (await db.execute(_sel(_f.max(StockDailyMetric.trade_date)))).scalar()
    theme_count = (await db.execute(_sel(_f.count()).select_from(StockTheme))).scalar() or 0
    scored = (await db.execute(
        _sel(_f.count()).select_from(StockTheme).where(StockTheme.phase.isnot(None))
    )).scalar() or 0
    metric_count = 0
    if last_date:
        metric_count = (await db.execute(
            _sel(_f.count()).select_from(StockDailyMetric).where(StockDailyMetric.trade_date == last_date)
        )).scalar() or 0

    return SystemStatusResponse(
        server_started_at=_SERVER_STARTED_AT,
        last_batch_at=last_batch,
        last_data_date=str(last_date) if last_date else None,
        theme_count=theme_count,
        scored_theme_count=scored,
        metric_count=metric_count,
    )


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
    summary="[P5-R4] 종목 스크리닝 (일배치 실데이터 / 미적재 시 mock)",
)
async def screen_stocks(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    pbr_max: Optional[float] = Query(default=None, description="PBR 최댓값 필터"),
    ma_alignment: Optional[str] = Query(default=None, description="이동평균 정렬: bullish|bearish|mixed"),
    score_min: Optional[float] = Query(default=None, description="종합점수 최솟값 필터"),
) -> list[ScreeningItemResponse]:
    """야간 배치가 적재한 stock_daily_metrics(최신일)에서 필터링. 미적재 시 mock 폴백."""
    from app.models.stock_metrics import StockDailyMetric
    from sqlalchemy import select, func as safunc

    latest = (await db.execute(safunc.max(StockDailyMetric.trade_date))).scalar()
    if latest is None:
        return stock_advanced_service.get_screening(pbr_max=pbr_max, ma_alignment=ma_alignment, score_min=score_min)

    q = select(StockDailyMetric).where(StockDailyMetric.trade_date == latest)
    if pbr_max is not None:
        q = q.where(StockDailyMetric.pbr.isnot(None), StockDailyMetric.pbr <= pbr_max)
    if ma_alignment:
        q = q.where(StockDailyMetric.ma_alignment == ma_alignment)
    if score_min is not None:
        q = q.where(StockDailyMetric.composite_score >= score_min)
    q = q.order_by(StockDailyMetric.composite_score.desc().nullslast()).limit(100)

    rows = (await db.execute(q)).scalars().all()
    out: list[ScreeningItemResponse] = []
    for i, m in enumerate(rows):
        tags = []
        if m.golden_cross:
            tags.append("golden_cross")
        if m.phase and m.phase != "neutral":
            tags.append(m.phase)
        if m.ma_alignment == "bullish":
            tags.append("ma_aligned")
        out.append(ScreeningItemResponse(
            stock_code=m.code, stock_name=m.name or m.code, theme="",
            pbr=m.pbr or 0.0, per=m.per or 0.0, composite_score=m.composite_score or 0.0,
            signal_tags=tags,
            ma_alignment=m.ma_alignment if m.ma_alignment in ("bullish", "bearish", "mixed") else "mixed",
            return_1m=m.return_1m or 0.0, return_3m=m.return_3m or 0.0, return_6m=m.return_6m or 0.0,
            is_top5=(i < 5), allocation_pct=0.0,
        ))
    return out


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
