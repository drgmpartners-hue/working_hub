"""테마 흐름(추세) 분석 — 네이버 테마 시세 일별 스냅샷 → 4국면 + 관심점수.

장마감 기준 하루 1회 스캔하여 theme_daily_snapshots에 누적,
누적된 흐름을 분석해 stock_themes에 관심점수/국면/등락률을 저장(화면은 읽기만).
KIS/KRX 불필요 — 네이버 테마 페이지 + (선택)네이버 뉴스 카운트만 사용.
"""
from __future__ import annotations

import logging
from datetime import date, timedelta
from statistics import mean
from typing import Optional

from sqlalchemy import select, delete, func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.stock import StockTheme
from app.models.stock_metrics import ThemeDailySnapshot
from app.services.collectors import theme_mapping_collector as tmc
from app.services.collectors.key_access import get_user_key
from app.services.collectors.naver_news_client import NaverNewsClient

logger = logging.getLogger(__name__)

# 관심점수 가중(40/30/30) + 국면 임계값 — 화면 정의대로
_W_PRICE, _W_BREADTH, _W_ATTENTION = 40, 30, 30
SNAPSHOT_RETENTION_DAYS = 35   # 흐름은 최근 ~30일이면 충분 → 오래된 건 정리

# 국면 코드
SURGE, EMERGING, HOT, FADING, QUIET = "surge", "emerging", "hot", "fading", "quiet"


async def scan_and_snapshot(
    db: AsyncSession, user_id: Optional[str] = None, max_pages: int = 7,
    with_news: bool = True, basis_date: Optional[date] = None,
) -> dict:
    """네이버 테마 시세(장마감) 스캔 → 오늘자 스냅샷 upsert. 선택적으로 뉴스 건수도."""
    quotes = await tmc.fetch_theme_quotes(max_pages)
    bd = basis_date or date.today()

    news_client = None
    if with_news and user_id:
        creds = await get_user_key(db, user_id, "naver_search")
        if creds:
            news_client = NaverNewsClient(*creds)

    for q in quotes:
        news_count = None
        if news_client:
            try:
                news_count = await news_client.count(q["name"])
            except Exception:
                news_count = None
        stmt = pg_insert(ThemeDailySnapshot).values(
            theme_name=q["name"], snapshot_date=bd,
            change_rate=q["change_rate"], up_count=q["up_count"],
            down_count=q["down_count"], news_count=news_count,
        ).on_conflict_do_update(
            constraint="uq_theme_snap_date",
            set_={"change_rate": q["change_rate"], "up_count": q["up_count"],
                  "down_count": q["down_count"], "news_count": news_count},
        )
        await db.execute(stmt)
    await db.commit()

    # 오래된 스냅샷 정리
    cutoff = bd - timedelta(days=SNAPSHOT_RETENTION_DAYS)
    await db.execute(delete(ThemeDailySnapshot).where(ThemeDailySnapshot.snapshot_date < cutoff))
    await db.commit()
    return {"scanned": len(quotes), "basis_date": str(bd), "with_news": news_client is not None}


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def compute_flow(snaps: list[ThemeDailySnapshot]) -> dict:
    """스냅샷 시계열(날짜 오름차순) → 관심점수 + 국면 + 근거. KIS 없이 계산."""
    chg = [s.change_rate or 0.0 for s in snaps]
    recent = chg[-3:]
    prev = chg[-10:-3] if len(chg) > 3 else []
    recent_avg = mean(recent) if recent else 0.0
    prev_avg = mean(prev) if prev else 0.0

    last = snaps[-1]
    up, down = (last.up_count or 0), (last.down_count or 0)
    breadth = up / (up + down) if (up + down) > 0 else 0.5

    news_vals = [s.news_count for s in snaps if s.news_count is not None]
    news_recent = mean(news_vals[-3:]) if news_vals else None
    news_prev = mean(news_vals[:-3]) if len(news_vals) > 3 else None

    # 관심점수(0~100)
    price = _clamp(20 + recent_avg * 4, 0, _W_PRICE)          # 0% → 20, +5% → 40
    breadth_score = breadth * _W_BREADTH
    if news_recent is not None:
        lvl = _clamp(news_recent / 20 * (_W_ATTENTION * 0.6), 0, _W_ATTENTION * 0.6)  # 절대량
        trend = 0.0
        if news_prev is not None and news_prev > 0:
            trend = _clamp((news_recent / news_prev - 1) * (_W_ATTENTION * 0.4), -_W_ATTENTION * 0.4, _W_ATTENTION * 0.4)
        attention = _clamp(lvl + max(0, trend), 0, _W_ATTENTION)
    else:
        attention = _W_ATTENTION * 0.5
    interest = round(price + breadth_score + attention, 1)

    # 국면 판정
    delta = recent_avg - prev_avg
    if abs(recent_avg) < 0.4 and breadth_score < 18 and (news_recent is None or news_recent < 3):
        phase = QUIET
    elif recent_avg >= 2.0 and breadth >= 0.6:
        phase = SURGE
    elif prev_avg < -0.3 and recent_avg > 0.5:
        phase = EMERGING
    elif recent_avg < prev_avg - 1.0:
        phase = FADING
    elif recent_avg > 0.5 and prev_avg > 0.0:
        phase = HOT
    elif recent_avg <= -1.0:
        phase = FADING
    else:
        phase = HOT if recent_avg > 0 else QUIET

    reason = (
        f"최근 등락 {recent_avg:+.1f}%(이전 {prev_avg:+.1f}%), "
        f"상승종목 {up}/{up + down}"
        + (f", 뉴스 {news_recent:.0f}건" + (f"(이전 {news_prev:.0f})" if news_prev else "") if news_recent is not None else "")
    )
    return {
        "interest_score": interest, "phase": phase, "reason": reason,
        "recent_avg": round(recent_avg, 2), "prev_avg": round(prev_avg, 2),
        "breadth": round(breadth, 2), "change_rate": last.change_rate,
        "up_count": up, "down_count": down,
        "flow": [{"date": str(s.snapshot_date), "change_rate": s.change_rate} for s in snaps],
    }


async def analyze_flow(db: AsyncSession) -> dict:
    """누적 스냅샷 분석 → stock_themes에 관심점수/국면/등락률/기준일 저장."""
    rows = (await db.execute(
        select(ThemeDailySnapshot).order_by(ThemeDailySnapshot.theme_name, ThemeDailySnapshot.snapshot_date)
    )).scalars().all()
    by_theme: dict[str, list[ThemeDailySnapshot]] = {}
    for s in rows:
        by_theme.setdefault(s.theme_name, []).append(s)

    themes = (await db.execute(select(StockTheme))).scalars().all()
    theme_by_name = {t.theme_name: t for t in themes}
    updated = 0
    latest_date = None
    for name, snaps in by_theme.items():
        t = theme_by_name.get(name)
        if not t:
            continue
        f = compute_flow(snaps)
        t.interest_score = f["interest_score"]
        t.attention_phase = f["phase"]
        t.change_rate = f["change_rate"]
        t.up_count = f["up_count"]
        t.down_count = f["down_count"]
        t.basis_date = snaps[-1].snapshot_date
        latest_date = snaps[-1].snapshot_date
        updated += 1
    await db.commit()
    return {"analyzed": updated, "basis_date": str(latest_date) if latest_date else None}
