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


def _basic_sections(theme: StockTheme, metrics: dict, period: str) -> dict:
    """AI 미설정/실패 시 안전망 — 수집 데이터로 만든 기본 서술(AI 설정 시 더 풍부해짐)."""
    phase = theme.attention_phase or QUIET
    pr = metrics.get("period_returns") or {}
    inv5 = (metrics.get("investors") or {}).get("d5") or {}
    note = "※ AI(Gemini 등) API가 설정되지 않아 기본 요약을 표시합니다. [설정 > AI]에서 키 등록 시 상세 분석이 생성됩니다."
    return {
        "summary": f"'{theme.theme_name}'은 현재 {_PHASE_LABEL.get(phase)} 국면(관심점수 {theme.interest_score}). "
                   f"기간수익률 1주 {pr.get('1w')}% · 1개월 {pr.get('1m')}% · 3개월 {pr.get('3m')}%. {note}",
        "flow": f"기간별 수익률 — 1주 {pr.get('1w')}%, 1개월 {pr.get('1m')}%, 3개월 {pr.get('3m')}%, 6개월 {pr.get('6m')}%, 1년 {pr.get('1y')}%.",
        "phase": _PHASE_BADGE_REASON.get(phase, ""),
        "leaders": "기여도 상위: " + ", ".join(f"{c['name']} {c['return_pct']}%" for c in (metrics.get("contributions") or [])[:5] if c.get("return_pct") is not None),
        "supply": f"최근 5일 순매수(억): 외국인 {inv5.get('foreign')}, 기관 {inv5.get('institution')}, 개인 {inv5.get('individual')}.",
        "axes_interp": "5축 점수는 그래프 참고. " + note,
        "catalyst": f"관련 기사 {metrics.get('news_count', 0):,}건.",
        "risk": "추세·변동성은 위 흐름 차트와 수급을 함께 확인하세요.",
        "verdict": _PHASE_CONCLUSION.get(phase, "") + " " + note,
    }


def _win_return(closes: list[float], w: int) -> Optional[float]:
    if len(closes) < 2:
        return None
    seg = closes[-(w + 1):] if len(closes) > w else closes
    if len(seg) < 2 or not seg[0]:
        return None
    return round((seg[-1] - seg[0]) / seg[0] * 100, 2)


async def build_report(db: AsyncSession, user_id: str, theme: StockTheme, period: str = "3m", refresh: bool = False) -> dict:
    """테마 보고서 — 다기간 흐름·투자자 수급·기여도·5축·뉴스 수집 후 LLM(Gemini)이 9섹션 종합.

    같은 날·테마·기간이면 캐시 반환(토큰 절약). refresh=True면 재생성.
    """
    from app.services.collectors.kis_client import KISClient
    from app.models.stock_metrics import ThemeReportCache
    from app.services import ai_report

    period = period if period in _PERIOD_DAYS else "3m"
    days = _PERIOD_DAYS[period]
    basis = theme.basis_date or date.today()

    # 캐시
    if not refresh:
        cached = (await db.execute(
            select(ThemeReportCache).where(
                ThemeReportCache.theme_name == theme.theme_name,
                ThemeReportCache.period == period,
                ThemeReportCache.basis_date == basis,
            )
        )).scalar_one_or_none()
        if cached:
            return cached.payload

    members = (await db.execute(
        select(ThemeMember.code, ThemeMember.name).where(ThemeMember.theme_name == theme.theme_name).limit(8)
    )).all()
    name_by_code = {c: n for c, n in members}
    codes = [c for c, _ in members]

    # --- 멤버 1년 시세 1회씩 → 다기간 수익률 + 지수 + 기여도 ---
    member_closes: dict[str, list[float]] = {}
    member_dates: dict[str, list[str]] = {}
    creds = await get_user_key(db, user_id, "kis")
    if creds and codes:
        client = KISClient(*creds)
        for code in codes[:6]:
            for attempt in range(2):  # 1회 재시도(레이트리밋 대비)
                try:
                    ohlcv = await client.get_daily_ohlcv(code, min_rows=260)
                    closes = [d["close"] for d in ohlcv]
                    if len(closes) >= 2:
                        member_closes[code] = closes
                        member_dates[code] = [d["date"] for d in ohlcv]
                    break
                except Exception:
                    continue

    # 다기간 수익률(테마 평균)
    period_returns: dict[str, Optional[float]] = {}
    for pk, pdays in _PERIOD_DAYS.items():
        rets = [r for code in member_closes if (r := _win_return(member_closes[code], pdays)) is not None]
        period_returns[pk] = round(mean(rets), 2) if rets else None

    # 선택 기간 지수 차트 + 기여도
    index_chart: list[dict] = []
    contributions: list[dict] = []
    series = []
    for code, closes in member_closes.items():
        seg = closes[-(days + 1):] if len(closes) > days else closes
        dseg = member_dates[code][-(days + 1):] if len(member_dates[code]) > days else member_dates[code]
        if len(seg) < 2 or not seg[0]:
            continue
        base = seg[0]
        cum = [round((c - base) / base * 100, 2) for c in seg]
        series.append((dseg, cum))
        contributions.append({"code": code, "name": name_by_code.get(code), "return_pct": cum[-1]})
    if series:
        minlen = min(len(s[1]) for s in series)
        dts = series[0][0][-minlen:]
        for i in range(minlen):
            vals = [s[1][len(s[1]) - minlen + i] for s in series]
            index_chart.append({"date": dts[i], "value": round(mean(vals), 2)})
    contributions.sort(key=lambda x: (x["return_pct"] is None, -(x["return_pct"] or 0)))

    # --- 투자자별 수급(외국인/기관/개인) 금액 5일·20일 (억원) ---
    investors = {"d5": {"foreign": 0.0, "institution": 0.0, "individual": 0.0},
                 "d20": {"foreign": 0.0, "institution": 0.0, "individual": 0.0}, "sample": 0}
    if creds and codes:
        client = KISClient(*creds)
        for code in codes[:6]:
            try:
                flows = await client.get_investor_flows(code)
            except Exception:
                flows = []
            if not flows:
                continue
            investors["sample"] += 1
            # KIS _tr_pbmn 단위는 백만원 → 억원 = ÷100
            for n, key in ((5, "d5"), (20, "d20")):
                for f in flows[:n]:
                    investors[key]["foreign"] += (f.get("foreign") or 0) / 100
                    investors[key]["institution"] += (f.get("institution") or 0) / 100
                    investors[key]["individual"] += (f.get("individual") or 0) / 100
    for k in ("d5", "d20"):
        for inv in ("foreign", "institution", "individual"):
            investors[k][inv] = round(investors[k][inv], 1)

    # --- 5축 + 증감 ---
    sd = theme.score_detail if isinstance(theme.score_detail, dict) else {}
    axes = sd.get("axes")
    prev_axes = sd.get("prev_axes")
    axes_delta = None
    if axes and prev_axes:
        axes_delta = {k: round(axes.get(k, 0) - prev_axes.get(k, 0), 1) for k in axes}

    # --- 뉴스 ---
    news_items: list[dict] = []
    news_count = 0
    ncreds = await get_user_key(db, user_id, "naver_search")
    if ncreds:
        nc = NaverNewsClient(*ncreds)
        for q in (theme.theme_name, theme.theme_name.split("(")[0].split("/")[0].strip()):
            try:
                news_items = await nc.search(q, display=5)
                news_count = await nc.count(q)
            except Exception:
                continue
            if news_items:
                break

    metrics = {
        "period_returns": period_returns,
        "index_chart": index_chart,
        "investors": investors,
        "contributions": contributions,
        "axes": axes,
        "prev_axes": prev_axes,
        "axes_delta": axes_delta,
        "news_count": news_count,
        "news": news_items,
        "sample_size": len(series),
        "up_count": theme.up_count,
        "down_count": theme.down_count,
    }

    # --- LLM 9섹션 생성 ---
    ai_input = {
        "테마명": theme.theme_name,
        "국면": _PHASE_LABEL.get(theme.attention_phase or QUIET),
        "관심점수": theme.interest_score,
        "오늘등락률(%)": theme.change_rate,
        "상승종목수": theme.up_count, "하락종목수": theme.down_count,
        "기간수익률(%)": period_returns,
        "선택기간": period,
        "투자자순매수(억원)": {"최근5일": investors["d5"], "최근20일": investors["d20"], "표본종목수": investors["sample"]},
        "종목기여도(기간수익률%)": [{"종목": c["name"], "수익률": c["return_pct"]} for c in contributions],
        "5축점수": axes, "5축_어제대비증감": axes_delta,
        "뉴스건수": news_count,
        "대표기사제목": [n.get("title", "") for n in news_items],
    }
    sections = await ai_report.generate_sections(db, user_id, ai_input)
    if not sections.get("summary"):
        sections = _basic_sections(theme, metrics, period)  # AI 미설정/실패 시 안전망

    payload = {
        "theme_id": theme.id,
        "theme_name": theme.theme_name,
        "attention_phase": theme.attention_phase or QUIET,
        "interest_score": theme.interest_score,
        "change_rate": theme.change_rate,
        "basis_date": str(basis),
        "period": period,
        "metrics": metrics,
        "sections": sections,
        "data_source": "live" if (index_chart or investors["sample"]) else ("partial" if sections else "mock"),
    }

    # 캐시 저장(있으면 갱신) — 실데이터(live)일 때만.
    # 장애 시각에 걸린 빈 payload가 캐시로 굳어 종일 빈 보고서가 고정되던 문제 방지.
    if payload["data_source"] != "live":
        return payload
    try:
        existing = (await db.execute(
            select(ThemeReportCache).where(
                ThemeReportCache.theme_name == theme.theme_name,
                ThemeReportCache.period == period,
                ThemeReportCache.basis_date == basis,
            )
        )).scalar_one_or_none()
        if existing:
            existing.payload = payload
        else:
            db.add(ThemeReportCache(theme_name=theme.theme_name, period=period, basis_date=basis, payload=payload))
        await db.commit()
    except Exception as e:
        logger.info("보고서 캐시 저장 실패(무시): %s", e)
        await db.rollback()

    return payload


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
