"""수집기 신뢰성 (수정_tasks P2-12) — 가짜 HTTP 로 시험(네트워크 없음)."""
import asyncio
from datetime import datetime

import httpx
import pytest

from app.services.collectors import http_retry


@pytest.fixture(autouse=True)
def _no_sleep(monkeypatch):
    async def fast(_):
        return None
    monkeypatch.setattr(asyncio, "sleep", fast)


_REAL_CLIENT = httpx.AsyncClient


def _patch_client(monkeypatch, handler):
    real = _REAL_CLIENT

    def make(*a, **kw):
        kw["transport"] = httpx.MockTransport(handler)
        return real(*a, **kw)
    monkeypatch.setattr(httpx, "AsyncClient", make)


async def test_retry_on_transient_then_success(monkeypatch):
    calls = []

    def handler(req):
        calls.append(1)
        return httpx.Response(503) if len(calls) < 3 else httpx.Response(200, json={"ok": True})
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
        r = await http_retry.get_with_retry(c, "https://x/y", tries=3)
    assert r.status_code == 200 and len(calls) == 3


async def test_no_retry_on_client_error():
    calls = []

    def handler(req):
        calls.append(1)
        return httpx.Response(401)
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
        r = await http_retry.get_with_retry(c, "https://x/y", tries=3)
    assert r.status_code == 401 and len(calls) == 1


def test_backoff_grows():
    assert 1.0 <= http_retry.backoff_delay(0) <= 1.25
    assert 2.0 <= http_retry.backoff_delay(1) <= 2.5
    assert 4.0 <= http_retry.backoff_delay(2) <= 5.0
    assert http_retry.backoff_delay(10) <= 10.0


async def test_naver_count_failure_is_none(monkeypatch):
    from app.services.collectors.naver_news_client import NaverNewsClient

    _patch_client(monkeypatch, lambda req: httpx.Response(429, json={}))
    assert await NaverNewsClient("i", "s").count("삼성") is None
    _patch_client(monkeypatch, lambda req: httpx.Response(200, json={"total": 0}))
    assert await NaverNewsClient("i", "s").count("삼성") == 0


async def test_dart_disclosures_failure_raises_but_no_data_is_empty(monkeypatch):
    from app.services.collectors.dart_client import DARTClient

    _patch_client(monkeypatch, lambda req: httpx.Response(200, json={"status": "020", "message": "요청 제한 초과"}))
    with pytest.raises(RuntimeError):
        await DARTClient("k").list_disclosures("00000001", "20260101", "20260131")
    _patch_client(monkeypatch, lambda req: httpx.Response(200, json={"status": "013", "message": "조회된 데이타가 없습니다."}))
    assert await DARTClient("k").list_disclosures("00000001", "20260101", "20260131") == []
    _patch_client(monkeypatch, lambda req: httpx.Response(500))
    with pytest.raises(RuntimeError):
        await DARTClient("k").list_disclosures("00000001", "20260101", "20260131")


async def test_dart_financial_years_not_hardcoded(monkeypatch):
    from app.services.collectors import dart_client

    seen = []

    async def corp(self, code):
        return "00000001"
    monkeypatch.setattr(dart_client.DARTClient, "get_corp_code", corp)

    def handler(req):
        seen.append(req.url.params.get("bsns_year"))
        return httpx.Response(200, json={"status": "013"})
    _patch_client(monkeypatch, handler)
    await dart_client.DARTClient("k").get_financials("005930")
    y = datetime.now().year
    assert seen == [str(y - 1), str(y - 2)]


async def test_kis_error_body_raises(monkeypatch):
    from app.services.collectors import kis_client

    async def headers(self, tr):
        return {}
    monkeypatch.setattr(kis_client.KISClient, "_headers", headers)
    _patch_client(monkeypatch, lambda req: httpx.Response(200, json={"rt_cd": "1", "msg_cd": "EGW00123", "msg1": "기간이 만료된 token"}))
    with pytest.raises(RuntimeError, match="만료"):
        await kis_client.KISClient("a", "b").get_price_info("005930")
    _patch_client(monkeypatch, lambda req: httpx.Response(200, json={"rt_cd": "0", "output": {"stck_prpr": "70000"}}))
    assert (await kis_client.KISClient("a", "b").get_price_info("005930"))["current_price"] == 70000.0


async def test_holiday_cache_ttl_and_stale_fallback(monkeypatch):
    from app.services.collectors import data_go_kr

    data_go_kr._holiday_cache.clear()
    body = {"response": {"body": {"items": {"item": [{"locdate": 20261009, "dateName": "한글날", "isHoliday": "Y"}]}}}}
    _patch_client(monkeypatch, lambda req: httpx.Response(200, json=body))
    h = await data_go_kr.get_holidays("k", 2026, 10)
    assert list(h.values()) == ["한글날"]
    # 오래돼서 다시 받는데 실패 → 예전 값 사용
    k = (2026, 10)
    data_go_kr._holiday_cache[k] = (0.0, data_go_kr._holiday_cache[k][1])
    _patch_client(monkeypatch, lambda req: httpx.Response(500))
    assert list((await data_go_kr.get_holidays("k", 2026, 10)).values()) == ["한글날"]
    data_go_kr._holiday_cache.clear()
