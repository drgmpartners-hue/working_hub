"""
Stock Advanced Mock Service — Phase 5 (P5-R3 ~ P5-R6).

⚠️ 산정 로직 사용자 자료 대기 — placeholder
모든 수치는 외부 API 없이 종목 코드 문자열 해시 기반으로 결정적(deterministic) 생성.
랜덤 함수 미사용.
"""
from __future__ import annotations

import hashlib
from datetime import date, timedelta
from typing import Optional

from app.schemas.stock import (
    BacktestChartPoint,
    BacktestResponse,
    DisparityResponse,
    MarketSignalsResponse,
    PerformanceItemResponse,
    PerformanceSummaryResponse,
    ScoreBreakdown,
    ScreeningItemResponse,
    SignalsBlock,
    StatusDistribution,
)

# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

_THEMES = ["반도체", "바이오", "2차전지", "AI·로봇", "방산", "에너지", "금융", "소비재"]
_NAMES_BY_CODE: dict[str, str] = {
    "005930": "삼성전자",
    "000660": "SK하이닉스",
    "035420": "NAVER",
    "035720": "카카오",
    "207940": "삼성바이오로직스",
    "068270": "셀트리온",
    "005380": "현대차",
    "000270": "기아",
    "096770": "SK이노베이션",
    "051910": "LG화학",
}

_MOCK_POOL: list[str] = list(_NAMES_BY_CODE.keys()) + [
    f"A{str(i).zfill(5)}" for i in range(1, 21)
]


def _hash_int(seed: str, lo: int = 0, hi: int = 100) -> int:
    """code 문자열에서 결정적 정수 생성 (범위: lo <= x <= hi)."""
    digest = int(hashlib.md5(seed.encode()).hexdigest(), 16)
    return lo + (digest % (hi - lo + 1))


def _hash_float(seed: str, lo: float = 0.0, hi: float = 100.0, decimals: int = 2) -> float:
    """code 문자열에서 결정적 float 생성."""
    digest = int(hashlib.md5(seed.encode()).hexdigest(), 16)
    raw = lo + (digest % 10_000) / 10_000 * (hi - lo)
    return round(raw, decimals)


def _hash_choice(seed: str, choices: list) -> object:
    idx = int(hashlib.md5(seed.encode()).hexdigest(), 16) % len(choices)
    return choices[idx]


def _stock_name(code: str) -> str:
    return _NAMES_BY_CODE.get(code, f"종목{code[-4:]}")


def _period_to_days(period: str) -> int:
    mapping = {"1m": 30, "3m": 90, "6m": 180, "1y": 365, "3y": 1095}
    return mapping[period]


# ---------------------------------------------------------------------------
# P5-R3: Market Signals (mock)
# ⚠️ 산정 로직 사용자 자료 대기 — placeholder
# ---------------------------------------------------------------------------

def get_market_signals(code: str) -> MarketSignalsResponse:
    """
    종목 코드 기반 결정적 시그널·종합점수 mock 반환.
    ⚠️ 산정 로직 사용자 자료 대기 — placeholder
    """
    base_price = _hash_float(f"{code}:base", 10_000, 200_000)
    ma5   = round(base_price * _hash_float(f"{code}:ma5_ratio",  0.95, 1.05), 0)
    ma20  = round(base_price * _hash_float(f"{code}:ma20_ratio", 0.90, 1.10), 0)
    ma60  = round(base_price * _hash_float(f"{code}:ma60_ratio", 0.85, 1.15), 0)
    ma120 = round(base_price * _hash_float(f"{code}:ma120_ratio", 0.80, 1.20), 0)

    golden = ma5 > ma20
    dead   = ma5 < ma20
    # bullish: ma5 > ma20 > ma60, bearish: ma5 < ma20 < ma60, 그 외 mixed
    if ma5 > ma20 and ma20 > ma60:
        alignment = "bullish"
    elif ma5 < ma20 and ma20 < ma60:
        alignment = "bearish"
    else:
        alignment = "mixed"

    disparity_ma20 = round((base_price - ma20) / ma20 * 100, 2)
    disparity_ma60 = round((base_price - ma60) / ma60 * 100, 2)

    # ⚠️ 산정 로직 사용자 자료 대기 — placeholder
    valuation = _hash_float(f"{code}:val", 10, 40, 1)
    momentum  = _hash_float(f"{code}:mom", 10, 40, 1)
    supply    = _hash_float(f"{code}:sup", 10, 20, 1)
    composite = round(valuation + momentum + supply, 1)
    composite = min(max(composite, 0), 100)

    roe = _hash_float(f"{code}:roe", -5.0, 30.0, 2)

    return MarketSignalsResponse(
        code=code,
        ma5=ma5,
        ma20=ma20,
        ma60=ma60,
        ma120=ma120,
        signals=SignalsBlock(
            golden_cross=golden,
            dead_cross=dead,
            ma_alignment=alignment,
            disparity=DisparityResponse(ma20=disparity_ma20, ma60=disparity_ma60),
        ),
        composite_score=composite,
        score_breakdown=ScoreBreakdown(
            valuation=valuation,
            momentum=momentum,
            supply=supply,
        ),
        roe=roe,
    )


# ---------------------------------------------------------------------------
# P5-R4: Stock Screening (mock)
# ⚠️ 산정 로직 사용자 자료 대기 — placeholder
# ---------------------------------------------------------------------------

def _make_screening_item(code: str) -> ScreeningItemResponse:
    """단일 종목 스크리닝 mock 데이터 생성."""
    name = _stock_name(code)
    theme = str(_hash_choice(f"{code}:theme", _THEMES))
    pbr   = _hash_float(f"{code}:pbr", 0.3, 5.0, 2)
    per   = _hash_float(f"{code}:per", 5.0, 50.0, 1)
    score = _hash_float(f"{code}:score", 20.0, 95.0, 1)

    all_tags = ["골든크로스", "기관순매수", "외국인순매수", "RSI과매도", "볼린저하단"]
    tag_count = _hash_int(f"{code}:tag_n", 0, 3)
    tags = [all_tags[i % len(all_tags)] for i in range(tag_count)]

    if _hash_float(f"{code}:ma5r", 0.95, 1.05) > 1.0 and _hash_float(f"{code}:ma20r", 0.90, 1.10) > 1.0:
        ma_align = "bullish"
    elif _hash_float(f"{code}:ma5r", 0.95, 1.05) < 1.0 and _hash_float(f"{code}:ma20r", 0.90, 1.10) < 1.0:
        ma_align = "bearish"
    else:
        ma_align = "mixed"

    r1m = _hash_float(f"{code}:r1m", -15.0, 25.0, 2)
    r3m = _hash_float(f"{code}:r3m", -20.0, 40.0, 2)
    r6m = _hash_float(f"{code}:r6m", -25.0, 60.0, 2)
    is_top5 = score >= 80.0
    alloc   = _hash_float(f"{code}:alloc", 1.0, 20.0, 1)

    return ScreeningItemResponse(
        stock_code=code,
        stock_name=name,
        theme=theme,
        pbr=pbr,
        per=per,
        composite_score=score,
        signal_tags=tags,
        ma_alignment=ma_align,
        return_1m=r1m,
        return_3m=r3m,
        return_6m=r6m,
        is_top5=is_top5,
        allocation_pct=alloc,
    )


def get_screening(
    pbr_max: Optional[float] = None,
    ma_alignment: Optional[str] = None,
    score_min: Optional[float] = None,
) -> list[ScreeningItemResponse]:
    """
    전체 mock 풀에서 스크리닝 후 필터 적용하여 반환.
    ⚠️ 산정 로직 사용자 자료 대기 — placeholder
    """
    items = [_make_screening_item(code) for code in _MOCK_POOL]

    if pbr_max is not None:
        items = [i for i in items if i.pbr <= pbr_max]
    if ma_alignment is not None:
        items = [i for i in items if i.ma_alignment == ma_alignment]
    if score_min is not None:
        items = [i for i in items if i.composite_score >= score_min]

    return items


# ---------------------------------------------------------------------------
# P5-R5: Backtest (mock)
# ⚠️ 산정 로직 사용자 자료 대기 — placeholder
# ---------------------------------------------------------------------------

_PERIOD_POINTS: dict[str, int] = {
    "1m": 22,
    "3m": 65,
    "6m": 130,
    "1y": 252,
    "3y": 756,
}


def get_backtest(code: str, period: str) -> BacktestResponse:
    """
    결정적 백테스트 mock 반환.
    ⚠️ 산정 로직 사용자 자료 대기 — placeholder
    """
    days = _period_to_days(period)
    n_points = _PERIOD_POINTS[period]

    entry_price   = _hash_float(f"{code}:{period}:entry", 10_000, 150_000, 0)
    current_price = _hash_float(f"{code}:{period}:curr", 10_000, 200_000, 0)
    return_rate   = round((current_price - entry_price) / entry_price * 100, 2)
    bench_return  = _hash_float(f"{code}:{period}:bench", -20.0, 40.0, 2)
    max_dd        = _hash_float(f"{code}:{period}:mdd", -30.0, -1.0, 2)

    today = date(2026, 6, 8)
    entry_date_obj = today - timedelta(days=days)
    entry_date = entry_date_obj.isoformat()

    chart_data: list[BacktestChartPoint] = []
    step_days = max(days // n_points, 1)
    for i in range(n_points):
        pt_date = entry_date_obj + timedelta(days=i * step_days)
        progress = i / max(n_points - 1, 1)
        pt_val   = round(entry_price * (1 + progress * return_rate / 100), 0)
        pt_bench = round(100.0 * (1 + progress * bench_return / 100), 2)
        chart_data.append(
            BacktestChartPoint(
                date=pt_date.isoformat(),
                value=pt_val,
                benchmark=pt_bench,
            )
        )

    return BacktestResponse(
        stock_code=code,
        period=period,
        entry_date=entry_date,
        entry_price=entry_price,
        current_price=current_price,
        return_rate=return_rate,
        benchmark_return=bench_return,
        max_drawdown=max_dd,
        chart_data=chart_data,
    )


# ---------------------------------------------------------------------------
# P5-R6: Recommendation Performance (mock)
# ⚠️ 산정 로직 사용자 자료 대기 — placeholder
# ---------------------------------------------------------------------------

_PERF_POOL_SIZE = 30
_STATUS_LIST: list[str] = ["hit", "miss", "holding"]


def _make_performance_item(idx: int) -> PerformanceItemResponse:
    """단일 추천 사후성과 mock 생성."""
    seed = f"perf:{idx}"
    code = _MOCK_POOL[idx % len(_MOCK_POOL)]
    name = _stock_name(code)
    theme = str(_hash_choice(f"{seed}:theme", _THEMES))
    status_val = str(_hash_choice(f"{seed}:status", _STATUS_LIST))

    holding_days = _hash_int(f"{seed}:days", 7, 365)
    today = date(2026, 6, 8)
    rec_date = (today - timedelta(days=holding_days)).isoformat()

    rec_price  = _hash_float(f"{seed}:rprice", 10_000, 150_000, 0)
    curr_price = _hash_float(f"{seed}:cprice", 10_000, 200_000, 0)
    ret_since  = round((curr_price - rec_price) / rec_price * 100, 2)
    bench_ret  = _hash_float(f"{seed}:bench", -10.0, 30.0, 2)
    excess     = round(ret_since - bench_ret, 2)
    score_at   = _hash_float(f"{seed}:score", 30.0, 95.0, 1)

    return PerformanceItemResponse(
        recommendation_id=f"rec-mock-{idx:04d}",
        stock_code=code,
        stock_name=name,
        theme=theme,
        recommended_date=rec_date,
        recommended_price=rec_price,
        current_price=curr_price,
        return_since=ret_since,
        benchmark_return=bench_ret,
        excess_return=excess,
        holding_days=holding_days,
        status=status_val,
        composite_score_at_rec=score_at,
    )


def _build_perf_pool() -> list[PerformanceItemResponse]:
    return [_make_performance_item(i) for i in range(_PERF_POOL_SIZE)]


def get_performance(
    theme: Optional[str] = None,
    status: Optional[str] = None,
    period: Optional[str] = None,
) -> list[PerformanceItemResponse]:
    """
    추천 사후성과 리스트 mock 반환, 필터 적용.
    ⚠️ 산정 로직 사용자 자료 대기 — placeholder
    """
    items = _build_perf_pool()

    if theme is not None:
        items = [i for i in items if i.theme == theme]
    if status is not None:
        items = [i for i in items if i.status == status]
    if period is not None:
        period_days = {"1m": 30, "3m": 90, "6m": 180, "1y": 365, "3y": 1095}.get(period)
        if period_days is not None:
            items = [i for i in items if i.holding_days <= period_days]

    return items


def get_performance_summary() -> PerformanceSummaryResponse:
    """
    추천 사후성과 요약 mock 반환.
    ⚠️ 산정 로직 사용자 자료 대기 — placeholder
    """
    items = _build_perf_pool()
    total = len(items)
    hit_count     = sum(1 for i in items if i.status == "hit")
    miss_count    = sum(1 for i in items if i.status == "miss")
    holding_count = sum(1 for i in items if i.status == "holding")

    hit_rate      = round(hit_count / total, 4) if total else 0.0
    avg_excess    = round(sum(i.excess_return for i in items) / total, 2) if total else 0.0
    avg_holding   = round(sum(i.holding_days for i in items) / total, 1) if total else 0.0

    return PerformanceSummaryResponse(
        hit_rate=hit_rate,
        avg_excess_return=avg_excess,
        tracked_count=total,
        avg_holding_days=avg_holding,
        status_distribution=StatusDistribution(
            hit=hit_count,
            miss=miss_count,
            holding=holding_count,
        ),
    )
