"""테마 점수 5축 집계 + 국면 가중치 스위칭 (08-stock-etf-recommend §5/§7).

테마 점수 = 소속 종목들의 실데이터(KIS/DART/네이버)를 5축으로 집계한 가중합.
국면(고점돌파/바닥탈출)에 따라 가중치를 스위칭한다.

⚠️ 가중치 초기값은 출발점 — '사후검증(recommendation_performance)'으로 데이터 기반 보정 예정.
"""
from __future__ import annotations

import math
import logging
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.services import market_data_service
from app.services.theme_stock_map import get_member_stocks
from app.services.collectors.key_access import get_user_key
from app.services.collectors.naver_news_client import NaverNewsClient

logger = logging.getLogger(__name__)

# 국면별 5축 가중치 (합=1.0)
_WEIGHTS = {
    "breakout":   {"momentum": 0.15, "supply": 0.10, "fundamentals": 0.40, "attention": 0.30, "valuation": 0.05},
    "turnaround": {"momentum": 0.30, "supply": 0.40, "fundamentals": 0.10, "attention": 0.12, "valuation": 0.08},
    "neutral":    {"momentum": 0.30, "supply": 0.25, "fundamentals": 0.20, "attention": 0.15, "valuation": 0.10},
}


async def _attention_score(theme_name: str, naver: Optional[tuple[str, str]]) -> float:
    """관심도(0~100): 테마 뉴스 건수 log 스케일. 키 없으면 중립 50."""
    if not naver:
        return 50.0
    try:
        cnt = await NaverNewsClient(*naver).count(theme_name)
        return round(min(100.0, math.log10(max(cnt, 1) + 1) * 25.0), 1)
    except Exception:
        return 50.0


async def aggregate_theme(db: AsyncSession, user_id: str, theme_name: str) -> Optional[dict]:
    """테마 5축 집계. 매핑/실데이터 없으면 None(→ placeholder 폴백).

    반환: {score, phase, axes{...}, weights{...}, members[...], data_source}
    """
    members = get_member_stocks(theme_name, limit=4)
    if not members:
        return None

    sigs = []
    for code, _name in members:
        s = await market_data_service.get_signals(db, user_id, code)  # 10분 캐시
        if s.data_source == "kis":
            sigs.append(s)
    if not sigs:
        return None

    n = len(sigs)
    # 종목 score_breakdown: valuation(0~40)/momentum(0~40)/supply(0~20) → 0~100 정규화
    momentum = sum(s.score_breakdown.momentum for s in sigs) / n / 40 * 100
    supply = sum(s.score_breakdown.supply for s in sigs) / n / 20 * 100
    valuation = sum(s.score_breakdown.valuation for s in sigs) / n / 40 * 100
    fundamentals = min(100.0, max(0.0, sum(s.roe for s in sigs) / n / 25 * 100))  # ROE 25%→100

    naver = await get_user_key(db, user_id, "naver_search")
    attention = await _attention_score(theme_name, naver)

    # 국면(theme): 소속 종목 phase 분포 — 30% 이상이면 채택
    breakout_ratio = sum(1 for s in sigs if s.phase == "breakout") / n
    turnaround_ratio = sum(1 for s in sigs if s.phase == "turnaround") / n
    if breakout_ratio >= 0.30:
        phase = "breakout"
    elif turnaround_ratio >= 0.30:
        phase = "turnaround"
    else:
        phase = "neutral"

    axes = {
        "momentum": round(momentum, 1),
        "supply": round(supply, 1),
        "fundamentals": round(fundamentals, 1),
        "attention": round(attention, 1),
        "valuation": round(valuation, 1),
    }
    w = _WEIGHTS[phase]
    score = round(sum(axes[k] * w[k] for k in w), 1)

    return {
        "score": score,
        "phase": phase,
        "axes": axes,
        "weights": w,
        "members": [{"code": s.code, "phase": s.phase, "score": s.composite_score} for s in sigs],
        "breakout_ratio": round(breakout_ratio, 2),
        "turnaround_ratio": round(turnaround_ratio, 2),
        "data_source": "live",
    }
