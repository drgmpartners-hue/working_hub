"""실데이터 시장 서비스 (08-stock-etf-recommend P5-R1/R2/R3).

KIS 실시세 + 지표 엔진으로 시그널·종합점수를 산출. 키가 없거나 실패 시 mock 폴백.
⚠️ composite_score 가중치는 사용자 자료로 확정 예정 — 현재는 지표 기반 잠정 산식.
"""
from __future__ import annotations

import logging
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.stock import (
    BacktestChartPoint,
    BacktestResponse,
    DisparityResponse,
    MarketSignalsResponse,
    ScoreBreakdown,
    SignalsBlock,
)
from app.services import stock_advanced_service, indicator_engine
from app.services.collectors.key_access import get_user_key
from app.services.collectors.kis_client import KISClient

logger = logging.getLogger(__name__)


def _valuation_score(per: float | None, pbr: float | None) -> float:
    """밸류에이션 점수(0~40) 잠정 산식: PER·PBR 낮을수록 높음.
    ⚠️ 가중치는 사용자 자료로 확정 예정.
    """
    score = 20.0
    if per and per > 0:
        score += max(-10, min(10, (15 - per)))   # PER 15 기준 ±10
    if pbr and pbr > 0:
        score += max(-10, min(10, (1.5 - pbr) * 6))  # PBR 1.5 기준 ±10
    return round(min(max(score, 0), 40), 1)


async def get_signals(db: AsyncSession, user_id: str, code: str) -> MarketSignalsResponse:
    """KIS 실데이터 기반 시그널. 실패 시 mock 폴백."""
    creds = await get_user_key(db, user_id, "kis")
    if not creds:
        return stock_advanced_service.get_market_signals(code)  # data_source="mock"

    app_key, app_secret = creds
    try:
        client = KISClient(app_key, app_secret)
        ohlcv = await client.get_daily_ohlcv(code)
        closes = [d["close"] for d in ohlcv if d.get("close")]
        sig = indicator_engine.compute_signals(closes)

        # 이평선 일부라도 데이터 부족(None)이면 mock 폴백 (스키마 float 필수)
        if any(sig[k] is None for k in ("ma5", "ma20", "ma60", "ma120")):
            logger.info("KIS 데이터 부족(<120거래일), mock 폴백: %s", code)
            return stock_advanced_service.get_market_signals(code)

        price_info = await client.get_price_info(code)
        ratio = await client.get_financial_ratio(code)

        per = price_info.get("per")
        pbr = price_info.get("pbr")
        valuation = _valuation_score(per, pbr)
        momentum = indicator_engine.compute_momentum_score(closes)
        supply = 20.0  # 수급 점수 placeholder (외국인/기관 연동 후 교체)
        composite = round(min(max(valuation + momentum + supply, 0), 100), 1)
        roe = ratio.get("roe")
        if roe is None:
            roe = 0.0

        return MarketSignalsResponse(
            code=code,
            ma5=sig["ma5"],
            ma20=sig["ma20"],
            ma60=sig["ma60"],
            ma120=sig["ma120"],
            signals=SignalsBlock(
                golden_cross=sig["golden_cross"],
                dead_cross=sig["dead_cross"],
                ma_alignment=sig["ma_alignment"],
                disparity=DisparityResponse(
                    ma20=sig["disparity_ma20"],
                    ma60=sig["disparity_ma60"],
                ),
            ),
            composite_score=composite,
            score_breakdown=ScoreBreakdown(
                valuation=valuation,
                momentum=momentum,
                supply=supply,
            ),
            roe=round(roe, 2),
            data_source="kis",
        )
    except Exception as e:
        logger.warning("KIS 실데이터 실패, mock 폴백 (code=%s): %s", code, e)
        return stock_advanced_service.get_market_signals(code)


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
