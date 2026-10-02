"""외부 API 호출 재시도 (수정_tasks P2-12).

일시적인 실패(연결 끊김·시간 초과·429 너무 많은 요청·5xx 서버 오류)만 기다렸다가 다시 시도한다.
기다리는 시간은 1초 → 2초 → 4초(+약간의 흔들림)로 늘린다. 4xx(키 오류 등)는 다시 해도 같으니 바로 돌려준다.
"""
from __future__ import annotations

import asyncio
import logging
import random
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

RETRY_STATUS = {429, 500, 502, 503, 504}


def backoff_delay(attempt: int, base: float = 1.0, cap: float = 8.0) -> float:
    """attempt=0,1,2… → 약 1, 2, 4초(최대 cap) + 0~25% 흔들림(여러 요청이 동시에 다시 몰리지 않게)."""
    d = min(cap, base * (2 ** attempt))
    return d + random.uniform(0, d * 0.25)


async def get_with_retry(client: httpx.AsyncClient, url: str, *, params: Optional[dict] = None,
                         headers: Optional[dict] = None, tries: int = 3, base: float = 1.0,
                         label: str = "") -> httpx.Response:
    """GET. 마지막 시도까지 일시적 실패면 마지막 응답을 돌려주거나(상태 코드) 예외를 다시 던진다."""
    last_exc: Optional[Exception] = None
    res: Optional[httpx.Response] = None
    for attempt in range(tries):
        try:
            res = await client.get(url, params=params, headers=headers)
            if res.status_code not in RETRY_STATUS:
                return res
            last_exc = None
        except (httpx.TransportError, httpx.TimeoutException) as e:
            last_exc = e
            res = None
        if attempt < tries - 1:
            delay = backoff_delay(attempt, base)
            logger.info("%s 일시 실패(%s) — %.1f초 뒤 다시 시도(%d/%d)", label or url,
                        res.status_code if res is not None else type(last_exc).__name__, delay, attempt + 2, tries)
            await asyncio.sleep(delay)
    if res is not None:
        return res
    raise last_exc  # type: ignore[misc]
