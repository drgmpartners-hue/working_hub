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


async def _finalize(db: AsyncSession, user_id: str, theme_name: str, rows: list[dict]) -> dict:
    """멤버별 정규화 입력(rows)으로 5축·국면·점수 산출. rows 항목:
    {code, mom(0~40), sup(0~20), val(0~40), roe, phase, comp}
    """
    n = len(rows)
    momentum = sum(r["mom"] for r in rows) / n / 40 * 100
    supply = sum(r["sup"] for r in rows) / n / 20 * 100
    valuation = sum(r["val"] for r in rows) / n / 40 * 100
    fundamentals = min(100.0, max(0.0, sum(r["roe"] for r in rows) / n / 25 * 100))

    naver = await get_user_key(db, user_id, "naver_search")
    attention = await _attention_score(theme_name, naver)

    breakout_ratio = sum(1 for r in rows if r["phase"] == "breakout") / n
    turnaround_ratio = sum(1 for r in rows if r["phase"] == "turnaround") / n
    if breakout_ratio >= 0.30:
        phase = "breakout"
    elif turnaround_ratio >= 0.30:
        phase = "turnaround"
    else:
        phase = "neutral"

    axes = {
        "momentum": round(momentum, 1), "supply": round(supply, 1),
        "fundamentals": round(fundamentals, 1), "attention": round(attention, 1),
        "valuation": round(valuation, 1),
    }
    w = weight_calibration._load_weights()[phase]
    score = round(sum(axes[k] * w[k] for k in w), 1)
    return {
        "score": score, "phase": phase, "axes": axes, "weights": w,
        "members": [{"code": r["code"], "phase": r["phase"], "score": r["comp"]} for r in rows],
        "breakout_ratio": round(breakout_ratio, 2),
        "turnaround_ratio": round(turnaround_ratio, 2),
        "data_source": "live",
    }


async def aggregate_theme(db: AsyncSession, user_id: str, theme_name: str) -> Optional[dict]:
    """테마 5축 집계 — 배치 지표(DB) 우선, 없으면 KIS 즉석 계산.

    1) 배치가 적재한 stock_daily_metrics가 있으면 그것으로(빠름)
    2) 없으면 멤버 종목을 KIS로 즉석 계산(느리지만 '분석' 클릭만으로 동작)
    멤버/실데이터 모두 없으면 None(placeholder).
    """
    codes = await _member_codes(db, theme_name, limit=6)
    if not codes:
        return None

    # 1) 배치 지표 우선
    latest = (await db.execute(
        select(StockDailyMetric.trade_date).order_by(StockDailyMetric.trade_date.desc()).limit(1)
    )).scalar()
    if latest:
        ms = (await db.execute(
            select(StockDailyMetric).where(
                StockDailyMetric.code.in_(codes), StockDailyMetric.trade_date == latest
            )
        )).scalars().all()
        rows = [
            {"code": m.code, "mom": m.momentum or 0, "sup": m.supply or 0, "val": m.valuation or 0,
             "roe": m.roe or 0, "phase": m.phase or "neutral", "comp": m.composite_score or 0}
            for m in ms if m.momentum is not None
        ]
        if rows:
            return await _finalize(db, user_id, theme_name, rows)

    # 2) KIS 즉석 계산 (배치 지표 없을 때)
    rows = []
    for code in codes[:4]:  # 즉석은 4종목으로 제한(속도)
        s = await market_data_service.get_signals(db, user_id, code)
        if s.data_source == "kis":
            rows.append({
                "code": s.code, "mom": s.score_breakdown.momentum, "sup": s.score_breakdown.supply,
                "val": s.score_breakdown.valuation, "roe": s.roe, "phase": s.phase,
                "comp": s.composite_score,
            })
    if not rows:
        return None
    return await _finalize(db, user_id, theme_name, rows)
