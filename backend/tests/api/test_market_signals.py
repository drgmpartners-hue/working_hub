"""Tests for Market Signals API (P5-R3).

GET /api/v1/market/stocks/{code}/signals
"""
from __future__ import annotations

from unittest.mock import MagicMock
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.deps import get_current_user
from app.models.user import User


def _make_user() -> User:
    user = MagicMock(spec=User)
    user.id = "user-001"
    user.is_active = True
    return user


def _make_app() -> FastAPI:
    from app.api.v1.market import router as market_router
    app = FastAPI()
    app.dependency_overrides[get_current_user] = lambda: _make_user()
    app.include_router(market_router, prefix="/api/v1")
    return app


class TestMarketSignals:
    """GET /api/v1/market/stocks/{code}/signals"""

    def test_returns_200(self):
        app = _make_app()
        with TestClient(app) as client:
            resp = client.get("/api/v1/market/stocks/005930/signals")
        assert resp.status_code == 200

    def test_response_has_code_field(self):
        app = _make_app()
        with TestClient(app) as client:
            resp = client.get("/api/v1/market/stocks/005930/signals")
        body = resp.json()
        assert body["code"] == "005930"

    def test_response_has_ma_fields(self):
        app = _make_app()
        with TestClient(app) as client:
            resp = client.get("/api/v1/market/stocks/005930/signals")
        body = resp.json()
        for field in ("ma5", "ma20", "ma60", "ma120"):
            assert field in body, f"Missing field: {field}"
            assert isinstance(body[field], (int, float)), f"{field} should be numeric"

    def test_response_has_signals_block(self):
        app = _make_app()
        with TestClient(app) as client:
            resp = client.get("/api/v1/market/stocks/005930/signals")
        body = resp.json()
        assert "signals" in body
        s = body["signals"]
        assert "golden_cross" in s
        assert "dead_cross" in s
        assert "ma_alignment" in s
        assert s["ma_alignment"] in ("bullish", "bearish", "mixed")
        assert "disparity" in s
        assert "ma20" in s["disparity"]
        assert "ma60" in s["disparity"]

    def test_response_has_composite_score(self):
        app = _make_app()
        with TestClient(app) as client:
            resp = client.get("/api/v1/market/stocks/005930/signals")
        body = resp.json()
        assert "composite_score" in body
        score = body["composite_score"]
        assert 0 <= score <= 100

    def test_response_has_score_breakdown(self):
        app = _make_app()
        with TestClient(app) as client:
            resp = client.get("/api/v1/market/stocks/005930/signals")
        body = resp.json()
        assert "score_breakdown" in body
        sb = body["score_breakdown"]
        for sub in ("valuation", "momentum", "supply"):
            assert sub in sb, f"Missing score_breakdown.{sub}"

    def test_response_has_roe(self):
        app = _make_app()
        with TestClient(app) as client:
            resp = client.get("/api/v1/market/stocks/005930/signals")
        body = resp.json()
        assert "roe" in body

    def test_deterministic_same_code_same_result(self):
        """동일 code → 동일 결과 (결정적 mock)"""
        app = _make_app()
        with TestClient(app) as client:
            r1 = client.get("/api/v1/market/stocks/A123/signals")
            r2 = client.get("/api/v1/market/stocks/A123/signals")
        assert r1.json()["composite_score"] == r2.json()["composite_score"]

    def test_deterministic_different_code_different_result(self):
        """다른 code → 다른 composite_score (해시 기반)"""
        app = _make_app()
        with TestClient(app) as client:
            r1 = client.get("/api/v1/market/stocks/005930/signals")
            r2 = client.get("/api/v1/market/stocks/000660/signals")
        # 두 종목은 다른 점수를 가져야 함 (해시 충돌 없으면)
        assert r1.json()["composite_score"] != r2.json()["composite_score"]

    def test_requires_authentication(self):
        from app.api.v1.market import router as market_router
        app_no_auth = FastAPI()
        app_no_auth.include_router(market_router, prefix="/api/v1")
        client = TestClient(app_no_auth, raise_server_exceptions=False)
        resp = client.get("/api/v1/market/stocks/005930/signals")
        assert resp.status_code == 401
