"""실데이터 시장 서비스 (08-stock-etf-recommend P5-R1/R2/R3).

KIS 실시세 + 지표 엔진으로 시그널·종합점수를 산출. 키가 없거나 실패 시 mock 폴백.
⚠️ composite_score 가중치는 사용자 자료로 확정 예정 — 현재는 지표 기반 잠정 산식.
"""
from __future__ import annotations

import time
import logging
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.stock import (
    BacktestChartPoint,
    BacktestResponse,
    DisparityResponse,
    FinancialTrendPoint,
    MarketSignalsResponse,
    NewsItem,
    ScoreBreakdown,
    SignalsBlock,
    StockInsightsResponse,
)
from app.services import stock_advanced_service, indicator_engine
from app.services.collectors.key_access import get_user_key
from app.services.collectors.kis_client import KISClient
from app.services.collectors.naver_news_client import NaverNewsClient
from app.services.collectors.dart_client import DARTClient

logger = logging.getLogger(__name__)

# 종목 signals TTL 캐시 (테마 5축 집계 시 동일 종목 중복 KIS 호출 방지)
_SIGNALS_CACHE: dict[str, tuple[float, MarketSignalsResponse]] = {}
_SIGNALS_TTL = 600  # 10분


def _supply_score(trend: dict | None) -> float:
    """수급 점수(0~20): 최근 외국인+기관 순매수 방향 기반. 데이터 없으면 중립 10.
    ⚠️ 가중치는 사용자 자료로 확정 예정.
    """
    if not trend:
        return 10.0
    net = (trend.get("foreign_net") or 0) + (trend.get("institution_net") or 0)
    if net > 0:
        return 16.0
    if net < 0:
        return 6.0
    return 10.0


def _valuation_score(per: float | None, pbr: float | None, *, peg_exempt: bool = False) -> float:
    """밸류에이션 점수(0~40) 잠정 산식: PER·PBR 낮을수록 높음.

    peg_exempt=True(고점돌파 + 이익성장률>0): 고PER 감점 면제 — 진짜 주도주를 놓치지 않기 위함.
    ⚠️ 가중치는 사용자 자료로 확정 예정.
    """
    score = 20.0
    if per and per > 0 and not peg_exempt:
        score += max(-10, min(10, (15 - per)))   # PER 15 기준 ±10
    elif peg_exempt:
        score += 5  # 성장으로 정당화된 고PER → 감점 대신 소폭 가산
    if pbr and pbr > 0:
        score += max(-10, min(10, (1.5 - pbr) * 6))  # PBR 1.5 기준 ±10
    return round(min(max(score, 0), 40), 1)


async def _compute_full_kis(client: "KISClient", code: str) -> Optional[dict]:
    """KIS 실데이터로 종목 전 지표를 한 번에 계산해 dict 반환. 데이터 부족 시 None.

    반환 키: close, ma5/20/60/120, golden_cross, dead_cross, ma_alignment,
            disparity_ma20/60, per, pbr, roe, foreign_net, institution_net,
            valuation, momentum, supply, composite, phase, phase_reasons,
            return_1m/3m/6m
    """
    ohlcv = await client.get_daily_ohlcv(code)
    closes = [d["close"] for d in ohlcv if d.get("close")]
    sig = indicator_engine.compute_signals(closes)
    if any(sig[k] is None for k in ("ma5", "ma20", "ma60", "ma120")):
        return None  # <120거래일

    price_info = await client.get_price_info(code)
    ratio = await client.get_financial_ratio(code)
    try:
        trend = await client.get_investor_trend(code)
    except Exception:
        trend = {}

    volumes = [d.get("volume", 0) for d in ohlcv]
    phase = indicator_engine.detect_phase(closes, volumes, (trend or {}).get("recent"))

    per, pbr = price_info.get("per"), price_info.get("pbr")
    growth = ratio.get("sales_growth")
    peg_exempt = phase["phase"] == "breakout" and bool(growth and growth > 0)
    valuation = _valuation_score(per, pbr, peg_exempt=peg_exempt)
    momentum = indicator_engine.compute_momentum_score(closes)
    supply = _supply_score(trend)
    composite = round(min(max(valuation + momentum + supply, 0), 100), 1)
    roe = ratio.get("roe") or 0.0

    def _ret(days: int) -> Optional[float]:
        if len(closes) > days:
            return round((closes[-1] - closes[-1 - days]) / closes[-1 - days] * 100, 2)
        return None

    return {
        "close": closes[-1],
        "ma5": sig["ma5"], "ma20": sig["ma20"], "ma60": sig["ma60"], "ma120": sig["ma120"],
        "golden_cross": sig["golden_cross"], "dead_cross": sig["dead_cross"],
        "ma_alignment": sig["ma_alignment"],
        "disparity_ma20": sig["disparity_ma20"], "disparity_ma60": sig["disparity_ma60"],
        "per": per, "pbr": pbr, "roe": round(roe, 2),
        "foreign_net": (trend or {}).get("foreign_net"),
        "institution_net": (trend or {}).get("institution_net"),
        "valuation": valuation, "momentum": momentum, "supply": supply,
        "composite": composite,
        "phase": phase["phase"], "phase_reasons": phase["reasons"],
        "return_1m": _ret(20), "return_3m": _ret(60), "return_6m": _ret(120),
    }


def _dict_to_signals(code: str, d: dict) -> MarketSignalsResponse:
    return MarketSignalsResponse(
        code=code, ma5=d["ma5"], ma20=d["ma20"], ma60=d["ma60"], ma120=d["ma120"],
        signals=SignalsBlock(
            golden_cross=d["golden_cross"], dead_cross=d["dead_cross"],
            ma_alignment=d["ma_alignment"],
            disparity=DisparityResponse(ma20=d["disparity_ma20"], ma60=d["disparity_ma60"]),
        ),
        composite_score=d["composite"],
        score_breakdown=ScoreBreakdown(valuation=d["valuation"], momentum=d["momentum"], supply=d["supply"]),
        roe=d["roe"], phase=d["phase"], phase_reasons=d["phase_reasons"], data_source="kis",
    )


async def get_signals(db: AsyncSession, user_id: str, code: str) -> MarketSignalsResponse:
    """KIS 실데이터 기반 시그널. 실패 시 mock 폴백. 성공 결과는 10분 TTL 캐시."""
    cache_key = f"{user_id}:{code}"
    cached = _SIGNALS_CACHE.get(cache_key)
    if cached and (time.monotonic() - cached[0]) < _SIGNALS_TTL:
        return cached[1]

    creds = await get_user_key(db, user_id, "kis")
    if not creds:
        return stock_advanced_service.get_market_signals(code)  # data_source="mock"
    try:
        full = await _compute_full_kis(KISClient(*creds), code)
        if full is None:
            return stock_advanced_service.get_market_signals(code)
        result = _dict_to_signals(code, full)
        _SIGNALS_CACHE[cache_key] = (time.monotonic(), result)
        return result
    except Exception as e:
        logger.warning("KIS 실데이터 실패, mock 폴백 (code=%s): %s", code, e)
        return stock_advanced_service.get_market_signals(code)


async def compute_metrics_dict(client: "KISClient", code: str) -> Optional[dict]:
    """배치용: KIS 실데이터 전 지표 dict (None=데이터부족). 예외는 호출측 처리."""
    return await _compute_full_kis(client, code)


_PERIOD_TRADING_DAYS = {"1m": 21, "3m": 63, "6m": 126, "1y": 252, "3y": 756}


def _max_drawdown(values: list[float]) -> float:
    """최대 낙폭(%) — 누적 고점 대비 최대 하락률 (음수)."""
    peak = values[0]
    mdd = 0.0
    for v in values:
        peak = max(peak, v)
        dd = (v - peak) / peak * 100
        mdd = min(mdd, dd)
    return round(mdd, 2)


async def get_backtest(db: AsyncSession, user_id: str, code: str, period: str):
    """KIS 실 OHLCV 기반 백테스트. KOSPI 벤치마크 대비. 실패 시 mock 폴백."""
    creds = await get_user_key(db, user_id, "kis")
    if not creds:
        return stock_advanced_service.get_backtest(code, period)

    app_key, app_secret = creds
    n = _PERIOD_TRADING_DAYS.get(period, 252)
    try:
        client = KISClient(app_key, app_secret)
        ohlcv = await client.get_daily_ohlcv(code, min_rows=n + 5)
        closes = [d["close"] for d in ohlcv]
        dates = [d["date"] for d in ohlcv]
        if len(closes) < 2:
            return stock_advanced_service.get_backtest(code, period)

        window = min(n, len(closes) - 1)
        seg_closes = closes[-(window + 1):]
        seg_dates = dates[-(window + 1):]
        entry_price = seg_closes[0]
        current_price = seg_closes[-1]
        return_rate = round((current_price - entry_price) / entry_price * 100, 2)
        mdd = _max_drawdown(seg_closes)

        # 벤치마크(KOSPI) — best effort
        benchmark_return = 0.0
        bench_seg: list[float] = []
        try:
            idx = await client.get_index_closes(min_rows=n + 5)
            idx_closes = [d["close"] for d in idx]
            if len(idx_closes) >= 2:
                bw = min(window, len(idx_closes) - 1)
                bench_seg = idx_closes[-(bw + 1):]
                benchmark_return = round((bench_seg[-1] - bench_seg[0]) / bench_seg[0] * 100, 2)
        except Exception as be:
            logger.info("KOSPI 벤치마크 조회 실패(무시): %s", be)

        # chart_data: ~40 포인트로 샘플링, 누적수익률(%) 기준
        step = max(1, len(seg_closes) // 40)
        chart: list[BacktestChartPoint] = []
        for i in range(0, len(seg_closes), step):
            value = round((seg_closes[i] - entry_price) / entry_price * 100, 2)
            if bench_seg and len(bench_seg) == len(seg_closes):
                bench = round((bench_seg[i] - bench_seg[0]) / bench_seg[0] * 100, 2)
            else:
                bench = 0.0
            chart.append(BacktestChartPoint(date=seg_dates[i], value=value, benchmark=bench))

        return BacktestResponse(
            stock_code=code,
            period=period,
            entry_date=seg_dates[0],
            entry_price=entry_price,
            current_price=current_price,
            return_rate=return_rate,
            benchmark_return=benchmark_return,
            max_drawdown=mdd,
            chart_data=chart,
            data_source="kis",
        )
    except Exception as e:
        logger.warning("KIS 백테스트 실패, mock 폴백 (code=%s): %s", code, e)
        return stock_advanced_service.get_backtest(code, period)


async def get_insights(db: AsyncSession, user_id: str, code: str, name: str | None) -> StockInsightsResponse:
    """네이버 뉴스 + DART 재무(매출·영업이익 trend). 키 없는 소스는 빈 값."""
    news: list[NewsItem] = []
    revenue: list[FinancialTrendPoint] = []
    operating: list[FinancialTrendPoint] = []
    source = "mock"

    naver = await get_user_key(db, user_id, "naver_search")
    if naver:
        try:
            raw = await NaverNewsClient(*naver).search(name or code, display=5)
            news = [NewsItem(**n) for n in raw]
            source = "live"
        except Exception as e:
            logger.info("네이버 뉴스 조회 실패(무시): %s", e)

    dart = await get_user_key(db, user_id, "dart")
    if dart:
        try:
            fin = await DARTClient(dart[0]).get_financials(code)
            revenue = [FinancialTrendPoint(**p) for p in fin.get("revenue_trend", [])]
            operating = [FinancialTrendPoint(**p) for p in fin.get("operating_profit_trend", [])]
            if revenue or operating:
                source = "live"
        except Exception as e:
            logger.info("DART 재무 조회 실패(무시): %s", e)

    return StockInsightsResponse(
        code=code,
        news=news,
        revenue_trend=revenue,
        operating_profit_trend=operating,
        data_source=source,
    )
