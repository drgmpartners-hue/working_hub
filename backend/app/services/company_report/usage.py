"""AI 사용량·추정 비용(월별) — 발송 설정 화면(P2-14).

llm_client가 프로세스 안에 모은 사용량을 app_settings 'ai_usage_YYYYMM'(JSON)에 더한다.
배치 스크립트 끝, 웹 서비스 파일 작업자 주기, 설정 화면 조회 때 flush한다. 금액은 공개 단가 기준 추정치.
"""
from __future__ import annotations

import json
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.services import llm_client, settings_store
from app.services.company_report.timeutil import today_kst

# 백만 토큰당 USD(입력, 출력) — 모델 이름에 들어 있는 단어로 찾는다. 설정 'ai_price_table'(JSON)로 덮어쓸 수 있다.
DEFAULT_PRICES = {
    "haiku": (1.0, 5.0),
    "sonnet": (2.0, 10.0),   # Sonnet 5.5
    "opus": (4.0, 20.0),     # Opus 5.5
    "gemini-3.1-pro": (2.0, 12.0),
    "gemini": (2.0, 12.0),
}


def _key(month: Optional[str] = None) -> str:
    return f"ai_usage_{(month or today_kst().strftime('%Y-%m')).replace('-', '')}"


async def flush(db: AsyncSession) -> None:
    await _flush_stages(db)
    add = llm_client.drain_usage()
    if not add:
        return
    k = _key()
    cur = json.loads(await settings_store.get(db, k, "{}") or "{}")
    for model, u in add.items():
        m = cur.setdefault(model, {"calls": 0, "input": 0, "output": 0})
        for f in ("calls", "input", "output"):
            m[f] = m.get(f, 0) + u.get(f, 0)
    await settings_store.set_value(db, k, json.dumps(cur))


def price_for(model: str, table: dict) -> tuple[float, float]:
    name = (model or "").lower()
    for k in sorted(table, key=len, reverse=True):
        if k in name:
            return tuple(table[k])  # type: ignore[return-value]
    return (0.0, 0.0)


async def month_usage(db: AsyncSession, month: Optional[str] = None) -> dict:
    await flush(db)
    data = json.loads(await settings_store.get(db, _key(month), "{}") or "{}")
    try:
        table = {**DEFAULT_PRICES, **json.loads(await settings_store.get(db, "ai_price_table", "{}") or "{}")}
    except ValueError:
        table = DEFAULT_PRICES
    rows, total = [], 0.0
    for model, u in sorted(data.items()):
        pin, pout = price_for(model, table)
        cost = u.get("input", 0) / 1e6 * pin + u.get("output", 0) / 1e6 * pout
        total += cost
        rows.append({"model": model, **u, "usd": round(cost, 2)})
    return {"month": month or today_kst().strftime("%Y-%m"), "rows": rows, "usd": round(total, 2)}


# --------------------------------------------------------------------------- 단계별 비용(발송 설정 'AI 비용' 카드)

CLAUDE_SEARCH_PER_1K = 10.0      # Claude 웹 검색, 1,000회당 USD
GEMINI_SEARCH_PER_1K = 14.0      # Gemini 구글 검색 그라운딩, 1,000회당 USD
GEMINI_FREE_SEARCHES = 5000      # 매달 무료(Gemini 3.x 공통)
DEFAULT_KRW = 1400.0

# (키, 이름, 주기) 주기: daily=매일 도는 단계(일평균×30), monthly=한 달 1번, irregular=필요할 때만(최근 30일 실제)
STAGES = [
    ("summary", "기사 요약", "daily"),
    ("facts", "사실 추출", "daily"),
    ("verify", "사실 자동 검증", "daily"),
    ("daily", "데일리 작성", "daily"),
    ("review1", "교차 검토 1차", "daily"),
    ("review2", "교차 검토 2차", "daily"),
    ("monthly", "월간 작성", "monthly"),
    ("backfill", "과거 데이터 구축", "irregular"),
    ("register", "기업 찾기(등록)", "irregular"),
    ("period", "기간 요약(화면 버튼)", "irregular"),
    ("other", "기타", "irregular"),
]


def _stage_key(month: str) -> str:
    return f"ai_stage_{month.replace('-', '')}"


async def _flush_stages(db: AsyncSession) -> None:
    add = llm_client.drain_stage_usage()
    if not add:
        return
    by_month: dict[str, dict] = {}
    for k, u in add.items():
        by_month.setdefault(k[:7], {})[k] = u
    for month, items in by_month.items():
        key = _stage_key(month)
        cur = json.loads(await settings_store.get(db, key, "{}") or "{}")
        for k, u in items.items():
            m = cur.setdefault(k, {"calls": 0, "input": 0, "output": 0, "searches": 0})
            for f in ("calls", "input", "output", "searches"):
                m[f] = m.get(f, 0) + u.get(f, 0)
        await settings_store.set_value(db, key, json.dumps(cur))


async def _all_json(db: AsyncSession, prefix: str) -> dict[str, dict]:
    from sqlalchemy import select

    from app.models.app_setting import AppSetting

    rows = (await db.execute(select(AppSetting.key, AppSetting.value).where(AppSetting.key.like(f"{prefix}%")))).all()
    out = {}
    for k, v in rows:
        try:
            out[k] = json.loads(v or "{}")
        except ValueError:
            continue
    return out


def token_cost(model: str, u: dict, table: dict) -> float:
    pin, pout = price_for(model, table)
    return u.get("input", 0) / 1e6 * pin + u.get("output", 0) / 1e6 * pout


def build_stage_report(entries: dict[str, dict], table: dict, today, old_token_usd: float = 0.0,
                       krw: float = DEFAULT_KRW) -> dict:
    """entries: {'YYYY-MM-DD|단계|모델': {calls,input,output,searches}} → 단계별 표(순수 함수)."""
    from datetime import date as _date, timedelta as _td

    # Gemini 검색은 매달 5,000회까지 무료 → 달마다 유료 비율
    g_month: dict[str, int] = {}
    for k, u in entries.items():
        day, _, model = k.split("|", 2)
        if "gemini" in model.lower():
            g_month[day[:7]] = g_month.get(day[:7], 0) + int(u.get("searches", 0))
    paid = {m: (max(0, n - GEMINI_FREE_SEARCHES) / n if n else 0.0) for m, n in g_month.items()}

    days = sorted({k.split("|", 1)[0] for k in entries})
    first = _date.fromisoformat(days[0]) if days else today
    span = max(1, (today - first).days + 1)
    recent_from = (today - _td(days=29)).isoformat()

    agg: dict[str, dict] = {}
    token_total = 0.0
    for k, u in entries.items():
        day, st, model = k.split("|", 2)
        a = agg.setdefault(st, {"calls": 0, "searches": 0, "usd": 0.0, "recent_usd": 0.0, "models": {}, "months": set(),
                                "today_calls": 0, "today_usd": 0.0})
        tc = token_cost(model, u, table)
        token_total += tc
        s = int(u.get("searches", 0))
        ml = model.lower()
        sc = s / 1000 * (CLAUDE_SEARCH_PER_1K if "claude" in ml else GEMINI_SEARCH_PER_1K * paid.get(day[:7], 0.0) if "gemini" in ml else 0)
        c = tc + sc
        a["calls"] += int(u.get("calls", 0))
        a["searches"] += s
        a["usd"] += c
        a["months"].add(day[:7])
        if day >= recent_from:
            a["recent_usd"] += c
        if day == today.isoformat():
            a["today_calls"] += int(u.get("calls", 0))
            a["today_usd"] += c
        a["models"][model] = a["models"].get(model, 0.0) + c

    rows = []
    known = {k for k, _, _ in STAGES}
    for key, label, kind in STAGES + [(k, k, "irregular") for k in sorted(agg) if k not in known]:
        a = agg.get(key)
        if not a:
            if key == "other":
                continue
            rows.append({"key": key, "label": label, "kind": kind, "models": [], "calls": 0, "searches": 0,
                         "usd": 0.0, "avg_calls": 0.0, "avg_usd": 0.0, "est_month_usd": 0.0, "today_calls": 0, "today_usd": 0.0})
            continue
        if kind == "monthly":
            est = a["usd"] / max(1, len(a["months"]))
            avg_usd, avg_calls = est / 30, a["calls"] / max(1, len(a["months"])) / 30
        elif kind == "irregular":
            est = a["recent_usd"]
            avg_usd, avg_calls = a["usd"] / span, a["calls"] / span
        else:
            avg_usd, avg_calls = a["usd"] / span, a["calls"] / span
            est = avg_usd * 30
        models = [m for m, _ in sorted(a["models"].items(), key=lambda x: -x[1])]
        rows.append({"key": key, "label": label, "kind": kind, "models": models, "calls": a["calls"],
                     "searches": a["searches"], "usd": round(a["usd"], 4), "avg_calls": round(avg_calls, 1),
                     "avg_usd": round(avg_usd, 4), "est_month_usd": round(est, 2),
                     "today_calls": a["today_calls"], "today_usd": round(a["today_usd"], 4)})
    tot = {f: round(sum(r[f] for r in rows), 4 if f != "est_month_usd" else 2) for f in ("usd", "avg_usd", "est_month_usd", "today_usd")}
    tot["calls"] = sum(r["calls"] for r in rows)
    tot["today_calls"] = sum(r["today_calls"] for r in rows)
    return {"since": first.isoformat() if days else None, "days": span if days else 0, "krw_rate": krw,
            "stages": rows, "total": tot, "before_usd": round(max(0.0, old_token_usd - token_total), 2)}


async def _krw_rate(db: AsyncSession) -> float:
    """가장 최근 데일리 브리핑의 원/달러 환율(없으면 1,400원)."""
    from sqlalchemy import select

    from app.models.news_briefing import NewsBriefing

    b = (await db.execute(select(NewsBriefing).order_by(NewsBriefing.briefing_date.desc()).limit(5))).scalars().all()
    for x in b:
        for m in (x.basic_info or {}).get("markets") or []:
            if m.get("key") == "usdkrw" and m.get("available") and m.get("close"):
                return float(m["close"])
    return DEFAULT_KRW


async def stage_report(db: AsyncSession) -> dict:
    await flush(db)
    try:
        table = {**DEFAULT_PRICES, **json.loads(await settings_store.get(db, "ai_price_table", "{}") or "{}")}
    except ValueError:
        table = DEFAULT_PRICES
    entries: dict[str, dict] = {}
    for _, data in (await _all_json(db, "ai_stage_")).items():
        entries.update(data)
    old = 0.0
    for _, data in (await _all_json(db, "ai_usage_")).items():
        for model, u in data.items():
            if isinstance(u, dict):
                old += token_cost(model, u, table)
    return build_stage_report(entries, table, today_kst(), old, await _krw_rate(db))


# --------------------------------------------------------------------------- 비용 종합(AI + SOLAPI, 일/월/분기/연)

# SOLAPI 기본 단가(원, VAT 별도, 기본 구간). 설정 'solapi_prices'(JSON)로 덮어쓸 수 있다.
SOLAPI_PRICES = {"alimtalk": 13.0, "lms": 45.0, "sms": 18.0}


def _period(day: str, unit: str) -> str:
    y, m = int(day[:4]), int(day[5:7])
    if unit == "day":
        return day
    if unit == "month":
        return day[:7]
    if unit == "quarter":
        return f"{y}-Q{(m - 1) // 3 + 1}"
    return str(y)


def _day_costs(entries: dict[str, dict], table: dict) -> dict[str, float]:
    """날짜별 AI 비용(USD) — 단계 기록(토큰 + 검색 요금)."""
    rep_by_day: dict[str, float] = {}
    g_month: dict[str, int] = {}
    for k, u in entries.items():
        day, _, model = k.split("|", 2)
        if "gemini" in model.lower():
            g_month[day[:7]] = g_month.get(day[:7], 0) + int(u.get("searches", 0))
    paid = {m: (max(0, n - GEMINI_FREE_SEARCHES) / n if n else 0.0) for m, n in g_month.items()}
    for k, u in entries.items():
        day, _, model = k.split("|", 2)
        ml = model.lower()
        s = int(u.get("searches", 0))
        sc = s / 1000 * (CLAUDE_SEARCH_PER_1K if "claude" in ml else GEMINI_SEARCH_PER_1K * paid.get(day[:7], 0.0) if "gemini" in ml else 0)
        rep_by_day[day] = rep_by_day.get(day, 0.0) + token_cost(model, u, table) + sc
    return rep_by_day


def build_cost_history(ai_by_day: dict[str, float], legacy_by_month: dict[str, float], sends: list[dict],
                       unit: str, krw: float, prices: dict) -> list[dict]:
    """sends: [{day, briefing_type, channel, messages, briefings}] → 기간별 행(최신 먼저). 순수 함수.
    legacy_by_month: 날짜별 기록을 시작하기 전 달의 AI 사용액(모델별 합계에서 뺀 나머지) — 월 이상 단위에만 넣는다."""
    rows: dict[str, dict] = {}

    def row(p: str) -> dict:
        return rows.setdefault(p, {"period": p, "ai_usd": 0.0, "legacy_usd": 0.0, "solapi_krw": 0.0, "messages": 0,
                                   "test_messages": 0, "sends": 0, "alimtalk": 0, "lms": 0})

    for day, usd in ai_by_day.items():
        row(_period(day, unit))["ai_usd"] += usd
    for month, usd in legacy_by_month.items():
        if usd <= 0:
            continue
        p = _period(month + "-01", unit) if unit != "day" else f"{month} (일별 기록 전)"
        row(p)["legacy_usd"] += usd
    for x in sends:
        r = row(_period(x["day"], unit))
        n = int(x.get("messages", 0))
        ch = "lms" if x.get("channel") == "lms" else "alimtalk"
        r["solapi_krw"] += n * float(prices.get(ch, 0))
        r[ch] += n
        if x.get("briefing_type") == "test":
            r["test_messages"] += n
        else:
            r["messages"] += n
            r["sends"] += int(x.get("briefings", 0))
    out = []
    for p in sorted(rows, reverse=True):
        r = rows[p]
        ai_krw = (r["ai_usd"] + r["legacy_usd"]) * krw
        total = ai_krw + r["solapi_krw"]
        out.append({**{k: (round(v, 4) if isinstance(v, float) else v) for k, v in r.items()},
                    "ai_krw": round(ai_krw), "solapi_krw": round(r["solapi_krw"]), "total_krw": round(total),
                    "per_send_krw": round(total / r["sends"]) if r["sends"] else None,
                    "per_message_krw": round(total / (r["messages"] + r["test_messages"])) if (r["messages"] + r["test_messages"]) else None})
    return out


async def cost_history(db: AsyncSession, unit: str = "month") -> dict:
    """발송 설정 '비용 종합' — AI 사용액 + SOLAPI 발송비, 발송 횟수, 1회당 평균."""
    from sqlalchemy import func, select

    from app.models.news_briefing import BriefingSendLog

    await flush(db)
    try:
        table = {**DEFAULT_PRICES, **json.loads(await settings_store.get(db, "ai_price_table", "{}") or "{}")}
    except ValueError:
        table = DEFAULT_PRICES
    try:
        prices = {**SOLAPI_PRICES, **json.loads(await settings_store.get(db, "solapi_prices", "{}") or "{}")}
    except ValueError:
        prices = SOLAPI_PRICES
    entries: dict[str, dict] = {}
    for _, data in (await _all_json(db, "ai_stage_")).items():
        entries.update(data)
    ai_by_day = _day_costs(entries, table)
    # 날짜별 기록 전 사용분(달마다 모델별 합계 - 단계 기록 토큰분)
    stage_tok_month: dict[str, float] = {}
    for k, u in entries.items():
        day, _, model = k.split("|", 2)
        stage_tok_month[day[:7]] = stage_tok_month.get(day[:7], 0.0) + token_cost(model, u, table)
    legacy: dict[str, float] = {}
    for key, data in (await _all_json(db, "ai_usage_")).items():
        ym = key.replace("ai_usage_", "")
        if len(ym) != 6:
            continue
        month = f"{ym[:4]}-{ym[4:]}"
        tot = sum(token_cost(m, u, table) for m, u in data.items() if isinstance(u, dict))
        legacy[month] = max(0.0, tot - stage_tok_month.get(month, 0.0))
    day_col = func.to_char(BriefingSendLog.sent_at, "YYYY-MM-DD")
    rows = (await db.execute(
        select(day_col, BriefingSendLog.briefing_type, BriefingSendLog.channel, func.count(),
               func.count(func.distinct(BriefingSendLog.briefing_id)))
        .where(BriefingSendLog.status == "requested")
        .group_by(day_col, BriefingSendLog.briefing_type, BriefingSendLog.channel)
    )).all()
    sends = [{"day": d, "briefing_type": t, "channel": ch, "messages": n, "briefings": b} for d, t, ch, n, b in rows]
    krw = await _krw_rate(db)
    items = build_cost_history(ai_by_day, legacy, sends, unit, krw, prices)
    tot = {k: sum((x[k] or 0) for x in items) for k in ("ai_krw", "solapi_krw", "total_krw", "sends", "messages", "test_messages")}
    tot["per_send_krw"] = round(tot["total_krw"] / tot["sends"]) if tot["sends"] else None
    return {"unit": unit, "krw_rate": krw, "prices": prices, "items": items, "total": tot,
            "tracking_since": min(ai_by_day) if ai_by_day else None}
