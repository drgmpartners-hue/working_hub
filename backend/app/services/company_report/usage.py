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
    "sonnet": (3.0, 15.0),
    "opus": (5.0, 25.0),
    "gemini-3.1-pro": (2.0, 12.0),
    "gemini": (2.0, 12.0),
}


def _key(month: Optional[str] = None) -> str:
    return f"ai_usage_{(month or today_kst().strftime('%Y-%m')).replace('-', '')}"


async def flush(db: AsyncSession) -> None:
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
