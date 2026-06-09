"""테마 점수 5축 집계 + 국면 가중치 스위칭 (08-stock-etf-recommend §5/§7).

테마 점수 = 소속 종목들의 실데이터(KIS/DART/네이버)를 5축으로 집계한 가중합.
국면(고점돌파/바닥탈출)에 따라 가중치를 스위칭한다.

⚠️ 가중치 초기값은 출발점 — '사후검증(recommendation_performance)'으로 데이터 기반 보정 예정.
"""
from __future__ import annotations

import math
import logging
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.services import market_data_service, weight_calibration  # noqa: F401
from app.services.theme_stock_map import get_member_stocks
from app.services.collectors.key_access import get_user_key
from app.services.collectors.naver_news_client import NaverNewsClient
from app.models.stock_metrics import ThemeMember, StockDailyMetric

logger = logging.getLogger(__name__)

# 국면별 5축 가중치 — 사후검증 보정값 우선, 없으면 기본값(weight_calibration.DEFAULT_WEIGHTS)
_WEIGHTS = weight_calibration.DEFAULT_WEIGHTS


async def _attention_score(theme_name: str, naver: Optional[tuple[str, str]]) -> float:
    """관심도(0~100): 테마 뉴스 건수 log 스케일. 키 없으면 중립 50."""
    if not naver:
        return 50.0
    try:
        cnt = await NaverNewsClient(*naver).count(theme_name)
        return round(min(100.0, math.log10(max(cnt, 1) + 1) * 25.0), 1)
    except Exception:
        return 50.0


async def _member_codes(db: AsyncSession, theme_name: str, limit: int = 6) -> list[str]:
    """테마 소속 종목코드 — DB(theme_members) 우선, 없으면 파일/큐레이션 폴백."""
    rows = (
        await db.execute(
            select(ThemeMember.code).where(ThemeMember.theme_name == theme_name).limit(limit)
        )
    ).scalars().all()
    if rows:
        return list(rows)
    return [c for c, _ in get_member_stocks(theme_name, limit=limit)]


async def aggregate_theme(db: AsyncSession, user_id: str, theme_name: str) -> Optional[dict]:
    """테마 5축 집계 — DB 매핑 + 배치 사전계산 지표(stock_daily_metrics)로 산출.

    KIS 라이브 호출 없이 DB만 읽어 빠르고 일관됨. 멤버/지표 없으면 None(placeholder 폴백).
    반환: {score, phase, axes{...}, weights{...}, members[...], data_source}
    """
    codes = await _member_codes(db, theme_name, limit=6)
    if not codes:
        return None

    # 각 멤버의 최신 지표 (배치 적재분)
    latest = (await db.execute(select(StockDailyMetric.trade_date).order_by(StockDailyMetric.trade_date.desc()).limit(1))).scalar()
    metrics = []
    if latest:
        rows = (
            await db.execute(
                select(StockDailyMetric).where(
                    StockDailyMetric.code.in_(codes), StockDailyMetric.trade_date == latest
                )
            )
        ).scalars().all()
        metrics = [m for m in rows if m.momentum is not None]
    if not metrics:
        return None  # 배치 지표 없음 → placeholder

    n = len(metrics)
    momentum = sum((m.momentum or 0) for m in metrics) / n / 40 * 100
    supply = sum((m.supply or 0) for m in metrics) / n / 20 * 100
    valuation = sum((m.valuation or 0) for m in metrics) / n / 40 * 100
    fundamentals = min(100.0, max(0.0, sum((m.roe or 0) for m in metrics) / n / 25 * 100))

    naver = await get_user_key(db, user_id, "naver_search")
    attention = await _attention_score(theme_name, naver)

    breakout_ratio = sum(1 for m in metrics if m.phase == "breakout") / n
    turnaround_ratio = sum(1 for m in metrics if m.phase == "turnaround") / n
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
    w = weight_calibration._load_weights()[phase]
    score = round(sum(axes[k] * w[k] for k in w), 1)

    return {
        "score": score,
        "phase": phase,
        "axes": axes,
        "weights": w,
        "members": [{"code": m.code, "phase": m.phase or "neutral", "score": m.composite_score or 0} for m in metrics],
        "breakout_ratio": round(breakout_ratio, 2),
        "turnaround_ratio": round(turnaround_ratio, 2),
        "data_source": "live",
    }
