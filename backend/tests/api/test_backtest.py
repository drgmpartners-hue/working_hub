"""Tests for Backtest API (P5-R5).

GET /api/v1/market/stocks/{code}/backtest?period=1y
"""
from __future__ import annotations

from unittest.mock import MagicMock, patch
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.services import stock_advanced_service


def _make_user() -> User:
    user = MagicMock(spec=User)
    user.id = "user-001"
    user.is_active = True
    return user


async def _fake_db():
    yield None


async def _fake_get_backtest(db, user_id, code, period):
    """KIS 호출 없이 mock 서비스로 위임 (계약/형상 검증용)."""
    return stock_advanced_service.get_backtest(code, period)


@pytest.fixture(autouse=True)
def _patch_market_service():
    with patch("app.api.v1.market.market_data_service.get_backtest", new=_fake_get_backtest):
        yield


def _make_app() -> FastAPI:
    from app.api.v1.market import router as market_router
    app = FastAPI()
    app.dependency_overrides[get_current_user] = lambda: _make_user()
    app.dependency_overrides[get_db] = _fake_db
    app.include_router(market_router, prefix="/api/v1")
    return app


class TestBacktest:
    """GET /api/v1/market/stocks/{code}/backtest"""

    def test_default_period_returns_200(self):
        app = _make_app()
        with TestClient(app) as client:
            resp = client.get("/api/v1/market/stocks/005930/backtest")
        assert resp.status_code == 200

    def test_explicit_period_1y_returns_200(self):
        app = _make_app()
        with TestClient(app) as client:
            resp = client.get("/api/v1/market/stocks/005930/backtest?period=1y")
        assert resp.status_code == 200

    def test_response_has_required_fields(self):
        app = _make_app()
        with TestClient(app) as client:
            resp = client.get("/api/v1/market/stocks/005930/backtest?period=1y")
        body = resp.json()
        required = (
            "stock_code", "period", "entry_date", "entry_price",
            "current_price", "return_rate", "benchmark_return",
            "max_drawdown", "chart_data",
        )
        for field in required:
            assert field in body, f"Missing field: {field}"

    def test_stock_code_matches_path(self):
        app = _make_app()
        with TestClient(app) as client:
            resp = client.get("/api/v1/market/stocks/000660/backtest?period=3m")
        assert resp.json()["stock_code"] == "000660"

    def test_period_echoed_in_response(self):
        app = _make_app()
        with TestClient(app) as client:
            resp = client.get("/api/v1/market/stocks/005930/backtest?period=6m")
        assert resp.json()["period"] == "6m"

    def test_chart_data_is_list_with_required_keys(self):
        app = _make_app()
        with TestClient(app) as client:
            resp = client.get("/api/v1/market/stocks/005930/backtest?period=1y")
        chart = resp.json()["chart_data"]
        assert isinstance(chart, list)
        assert len(chart) > 0
        for point in chart:
            assert "date" in point
            assert "value" in point
            assert "benchmark" in point

    def test_all_valid_periods(self):
        """period ∈ {1m, 3m, 6m, 1y, 3y} 모두 200 반환"""
        app = _make_app()
        with TestClient(app) as client:
            for period in ("1m", "3m", "6m", "1y", "3y"):
                resp = client.get(
                    f"/api/v1/market/stocks/005930/backtest?period={period}"
                )
                assert resp.status_code == 200, f"Failed for period={period}"

    def test_invalid_period_returns_422(self):
        """유효하지 않은 period → 422"""
        app = _make_app()
        with TestClient(app) as client:
            resp = client.get("/api/v1/market/stocks/005930/backtest?period=99x")
        assert resp.status_code == 422

    def test_deterministic_same_code_period(self):
        """동일 code+period → 동일 return_rate"""
        app = _make_app()
        with TestClient(app) as client:
            r1 = client.get("/api/v1/market/stocks/005930/backtest?period=1y")
            r2 = client.get("/api/v1/market/stocks/005930/backtest?period=1y")
        assert r1.json()["return_rate"] == r2.json()["return_rate"]

    def test_chart_data_length_varies_by_period(self):
        """period가 길수록 chart_data 포인트 수 더 많음"""
        app = _make_app()
        with TestClient(app) as client:
            r_1m = client.get("/api/v1/market/stocks/005930/backtest?period=1m")
            r_1y = client.get("/api/v1/market/stocks/005930/backtest?period=1y")
        len_1m = len(r_1m.json()["chart_data"])
        len_1y = len(r_1y.json()["chart_data"])
        assert len_1y > len_1m

    def test_requires_authentication(self):
        from app.api.v1.market import router as market_router
        app_no_auth = FastAPI()
        app_no_auth.include_router(market_router, prefix="/api/v1")
        client = TestClient(app_no_auth, raise_server_exceptions=False)
        resp = client.get("/api/v1/market/stocks/005930/backtest")
        assert resp.status_code == 401
