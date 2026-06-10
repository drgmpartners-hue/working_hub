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
from app.models.stock_metrics import ThemeDailySnapshot, ThemeMember
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


_PERIOD_DAYS = {"1w": 5, "1m": 21, "3m": 63, "6m": 126, "1y": 252}

_PHASE_LABEL = {
    SURGE: "🔥 급등", EMERGING: "✨ 신규 관심", HOT: "📈 고관심",
    FADING: "📉 시들", QUIET: "⚪ 무관심",
}
_PHASE_BADGE_REASON = {
    SURGE: "최근 등락이 가파르게 상승하고 상승 종목 비중이 넓어 '급등' 국면으로 분류했습니다.",
    EMERGING: "직전까지 약세였다가 최근 상승으로 전환돼 '신규 관심(저점 탈출)' 국면입니다.",
    HOT: "등락·관심이 꾸준히 강세를 유지해 '고관심 지속' 국면입니다.",
    FADING: "상승세가 꺾여 하락으로 돌아서 '시들' 국면입니다.",
    QUIET: "변동과 관심이 모두 미미해 '무관심' 국면입니다.",
}
_PHASE_CONCLUSION = {
    SURGE: "상승 폭이 크고 관심이 몰리는 구간입니다. 추격 부담은 있으나 단기 모멘텀 후보로 적합합니다.",
    EMERGING: "바닥에서 막 돌아서는 초입입니다. 선제적으로 담아둘 후보로 매력적입니다.",
    HOT: "강세가 지속되는 주도 테마입니다. 핵심 후보로 담을 만합니다.",
    FADING: "상승세가 식고 있어 신규 진입은 신중해야 합니다. 보류 권장.",
    QUIET: "관심·변동이 적습니다. 지금 단계에서는 후보에서 제외해도 무방합니다.",
}


async def build_report(db: AsyncSession, user_id: str, theme: StockTheme, period: str = "3m") -> dict:
    """보고서용 깊은 분석 — 멤버 과거시세로 기간별 테마 지수 재구성 + 뉴스. 그 테마만 조회."""
    from app.services.collectors.kis_client import KISClient

    period = period if period in _PERIOD_DAYS else "3m"
    days = _PERIOD_DAYS[period]

    # 소속 종목
    members = (await db.execute(
        select(ThemeMember.code, ThemeMember.name).where(ThemeMember.theme_name == theme.theme_name).limit(8)
    )).all()
    codes = [c for c, _ in members]

    index_chart: list[dict] = []
    member_returns: dict[str, float] = {}
    creds = await get_user_key(db, user_id, "kis")
    if creds and codes:
        try:
            client = KISClient(*creds)
            series = []  # (dates, cumret[])
            for code in codes[:6]:
                try:
                    ohlcv = await client.get_daily_ohlcv(code, min_rows=days + 5)
                except Exception:
                    continue
                closes = [d["close"] for d in ohlcv][-(days + 1):]
                dts = [d["date"] for d in ohlcv][-(days + 1):]
                if len(closes) < 2 or not closes[0]:
                    continue
                base = closes[0]
                cum = [round((c - base) / base * 100, 2) for c in closes]
                series.append((dts, cum))
                member_returns[code] = cum[-1]
            if series:
                minlen = min(len(s[1]) for s in series)
                dts = series[0][0][-minlen:]
                for i in range(minlen):
                    vals = [s[1][len(s[1]) - minlen + i] for s in series]
                    index_chart.append({"date": dts[i], "value": round(mean(vals), 2)})
        except Exception as e:
            logger.info("테마 지수 구성 실패(무시) %s: %s", theme.theme_name, e)

    period_return = index_chart[-1]["value"] if index_chart else None

    # 뉴스
    news_items: list[dict] = []
    news_count = 0
    ncreds = await get_user_key(db, user_id, "naver_search")
    if ncreds:
        try:
            nc = NaverNewsClient(*ncreds)
            news_items = await nc.search(theme.theme_name, display=5)
            news_count = await nc.count(theme.theme_name)
        except Exception as e:
            logger.info("테마 뉴스 조회 실패(무시): %s", e)

    phase = theme.attention_phase or QUIET
    sd = theme.score_detail or {}
    axes = sd.get("axes") if isinstance(sd, dict) else None
    score_reason = (
        f"관심점수 {theme.interest_score}점 — 가격추세(오늘 {theme.change_rate:+.1f}%), "
        f"상승종목 {theme.up_count or 0}/{(theme.up_count or 0) + (theme.down_count or 0)}"
        + (f", 뉴스 {news_count}건" if news_count else "")
        + (f". 5축: 모멘텀 {axes['momentum']:.0f}·수급 {axes['supply']:.0f}·실적 {axes['fundamentals']:.0f}·관심 {axes['attention']:.0f}·밸류 {axes['valuation']:.0f}" if axes else "")
    )

    return {
        "theme_id": theme.id,
        "theme_name": theme.theme_name,
        "attention_phase": phase,
        "interest_score": theme.interest_score,
        "change_rate": theme.change_rate,
        "basis_date": str(theme.basis_date) if theme.basis_date else None,
        "period": period,
        "index_chart": index_chart,
        "period_return": period_return,
        "score_reason": score_reason,
        "badge_reason": _PHASE_BADGE_REASON.get(phase, ""),
        "members": [{"code": c, "name": n, "return_pct": member_returns.get(c)} for c, n in members],
        "news": news_items,
        "news_count": news_count,
        "conclusion": _PHASE_CONCLUSION.get(phase, ""),
        "data_source": "live" if index_chart else "mock",
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
