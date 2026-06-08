"""기술적 지표 계산 엔진 (08-stock-etf-recommend P5-R2).

종가 시계열에서 이동평균선·골든/데드크로스·정배열·이격도를 계산한다.
(수집이 아니라 계산 — 08 §5)
⚠️ composite_score(종합점수) 가중치 로직은 사용자 제공 자료로 확정 예정 — 현재는 지표 기반 잠정 산식.
"""
from __future__ import annotations

from typing import Optional


def sma(closes: list[float], window: int) -> Optional[float]:
    """최근 window개 종가의 단순이동평균. 데이터 부족 시 None."""
    if len(closes) < window:
        return None
    return round(sum(closes[-window:]) / window, 1)


def _crossed_up(short_series: list[float], long_series: list[float]) -> bool:
    """직전엔 short<=long, 최신엔 short>long → 골든크로스."""
    if len(short_series) < 2 or len(long_series) < 2:
        return False
    return short_series[-2] <= long_series[-2] and short_series[-1] > long_series[-1]


def _crossed_down(short_series: list[float], long_series: list[float]) -> bool:
    if len(short_series) < 2 or len(long_series) < 2:
        return False
    return short_series[-2] >= long_series[-2] and short_series[-1] < long_series[-1]


def _sma_series(closes: list[float], window: int) -> list[float]:
    if len(closes) < window:
        return []
    return [round(sum(closes[i - window:i]) / window, 4) for i in range(window, len(closes) + 1)]


def compute_signals(closes: list[float]) -> dict:
    """종가 리스트(오래된→최신)에서 이평선·시그널 산출.

    반환: {ma5, ma20, ma60, ma120, golden_cross, dead_cross, ma_alignment,
           disparity_ma20, disparity_ma60, current_price}
    """
    if not closes:
        raise ValueError("closes is empty")

    price = closes[-1]
    ma5, ma20, ma60, ma120 = (sma(closes, w) for w in (5, 20, 60, 120))

    # 골든/데드크로스: 5일선 vs 20일선
    s5 = _sma_series(closes, 5)
    s20 = _sma_series(closes, 20)
    golden = _crossed_up(s5, s20)
    dead = _crossed_down(s5, s20)

    # 정배열/역배열: ma5 > ma20 > ma60 (bullish) / 반대 (bearish)
    if ma5 and ma20 and ma60:
        if ma5 > ma20 > ma60:
            alignment = "bullish"
        elif ma5 < ma20 < ma60:
            alignment = "bearish"
        else:
            alignment = "mixed"
    else:
        alignment = "mixed"

    disparity_ma20 = round((price - ma20) / ma20 * 100, 2) if ma20 else 0.0
    disparity_ma60 = round((price - ma60) / ma60 * 100, 2) if ma60 else 0.0

    return {
        "ma5": ma5,
        "ma20": ma20,
        "ma60": ma60,
        "ma120": ma120,
        "golden_cross": golden,
        "dead_cross": dead,
        "ma_alignment": alignment,
        "disparity_ma20": disparity_ma20,
        "disparity_ma60": disparity_ma60,
        "current_price": price,
    }


def compute_momentum_score(closes: list[float]) -> float:
    """모멘텀 점수(0~40) 잠정 산식: 정배열 + 최근 수익률 기반.
    ⚠️ 가중치는 사용자 자료로 확정 예정.
    """
    if len(closes) < 20:
        return 20.0
    ret_20 = (closes[-1] - closes[-20]) / closes[-20] * 100
    # -10%~+10% → 10~40점 선형 매핑, clamp
    score = 25 + ret_20 * 1.5
    return round(min(max(score, 0), 40), 1)
