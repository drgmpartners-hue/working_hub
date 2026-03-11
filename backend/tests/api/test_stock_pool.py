"""Tests for Company Stock Pool API (P3-R6-T1).

GET  /api/v1/stocks/pool
POST /api/v1/stocks/pool
"""
from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1.stock import router as stock_router
from app.core.deps import get_current_user
from app.models.user import User
from app.models.stock import CompanyStockPool


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_NOW = datetime(2026, 3, 11, 0, 0, 0, tzinfo=timezone.utc)


def _make_user() -> User:
    user = MagicMock(spec=User)
    user.id = "user-001"
    user.is_active = True
    return user


def _make_pool(
    pool_id: str = "pool-001",
    pool_name: str = "2026년 1분기 풀",
) -> CompanyStockPool:
    obj = MagicMock(spec=CompanyStockPool)
    obj.id = pool_id
    obj.pool_name = pool_name
    obj.stocks = {
        "005930": {"name": "삼성전자", "weight": 30},
        "000660": {"name": "SK하이닉스", "weight": 20},
    }
    obj.created_at = _NOW
    return obj


def _make_app() -> FastAPI:
    app = FastAPI()
    app.dependency_overrides[get_current_user] = lambda: _make_user()
    app.include_router(stock_router, prefix="/api/v1")
    return app


# ---------------------------------------------------------------------------
# GET /api/v1/stocks/pool
# ---------------------------------------------------------------------------

class TestListStockPool:
    """GET /api/v1/stocks/pool"""

    def test_list_returns_200(self):
        fake_pools = [_make_pool("p1"), _make_pool("p2", "2026년 2분기 풀")]
        with patch(
            "app.api.v1.stock.stock_service.get_stock_pool",
            new=AsyncMock(return_value=fake_pools),
        ):
            app = _make_app()
            with TestClient(app) as client:
                resp = client.get("/api/v1/stocks/pool")
        assert resp.status_code == 200
        assert len(resp.json()) == 2

    def test_list_response_schema(self):
        fake_pool = _make_pool()
        with patch(
            "app.api.v1.stock.stock_service.get_stock_pool",
            new=AsyncMock(return_value=[fake_pool]),
        ):
            app = _make_app()
            with TestClient(app) as client:
                resp = client.get("/api/v1/stocks/pool")
        assert resp.status_code == 200
        body = resp.json()[0]
        for field in ("id", "pool_name", "stocks", "created_at"):
            assert field in body, f"Missing field: {field}"

    def test_list_requires_authentication(self):
        app_no_auth = FastAPI()
        app_no_auth.include_router(stock_router, prefix="/api/v1")
        client = TestClient(app_no_auth, raise_server_exceptions=False)
        resp = client.get("/api/v1/stocks/pool")
        assert resp.status_code == 401

    def test_list_empty_returns_empty_list(self):
        with patch(
            "app.api.v1.stock.stock_service.get_stock_pool",
            new=AsyncMock(return_value=[]),
        ):
            app = _make_app()
            with TestClient(app) as client:
                resp = client.get("/api/v1/stocks/pool")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_list_stocks_field_is_dict(self):
        fake_pool = _make_pool()
        with patch(
            "app.api.v1.stock.stock_service.get_stock_pool",
            new=AsyncMock(return_value=[fake_pool]),
        ):
            app = _make_app()
            with TestClient(app) as client:
                resp = client.get("/api/v1/stocks/pool")
        body = resp.json()[0]
        assert isinstance(body["stocks"], dict)


# ---------------------------------------------------------------------------
# POST /api/v1/stocks/pool
# ---------------------------------------------------------------------------

class TestAddToStockPool:
    """POST /api/v1/stocks/pool"""

    def test_add_returns_201(self):
        fake_pool = _make_pool()
        with patch(
            "app.api.v1.stock.stock_service.add_to_pool",
            new=AsyncMock(return_value=fake_pool),
        ):
            app = _make_app()
            with TestClient(app) as client:
                resp = client.post(
                    "/api/v1/stocks/pool",
                    json={
                        "pool_name": "2026년 1분기 풀",
                        "stocks": {"005930": {"name": "삼성전자", "weight": 30}},
                    },
                )
        assert resp.status_code == 201

    def test_add_response_schema(self):
        fake_pool = _make_pool()
        with patch(
            "app.api.v1.stock.stock_service.add_to_pool",
            new=AsyncMock(return_value=fake_pool),
        ):
            app = _make_app()
            with TestClient(app) as client:
                resp = client.post(
                    "/api/v1/stocks/pool",
                    json={
                        "pool_name": "2026년 1분기 풀",
                        "stocks": {"005930": {"name": "삼성전자", "weight": 30}},
                    },
                )
        assert resp.status_code == 201
        body = resp.json()
        for field in ("id", "pool_name", "stocks", "created_at"):
            assert field in body, f"Missing field: {field}"
        assert body["pool_name"] == "2026년 1분기 풀"

    def test_add_missing_pool_name_returns_422(self):
        app = _make_app()
        with TestClient(app) as client:
            resp = client.post(
                "/api/v1/stocks/pool",
                json={"stocks": {"005930": {"name": "삼성전자"}}},
            )
        assert resp.status_code == 422

    def test_add_missing_stocks_returns_422(self):
        app = _make_app()
        with TestClient(app) as client:
            resp = client.post(
                "/api/v1/stocks/pool",
                json={"pool_name": "테스트 풀"},
            )
        assert resp.status_code == 422

    def test_add_requires_authentication(self):
        app_no_auth = FastAPI()
        app_no_auth.include_router(stock_router, prefix="/api/v1")
        client = TestClient(app_no_auth, raise_server_exceptions=False)
        resp = client.post(
            "/api/v1/stocks/pool",
            json={
                "pool_name": "테스트 풀",
                "stocks": {"005930": {"name": "삼성전자"}},
            },
        )
        assert resp.status_code == 401

    def test_add_stocks_can_be_empty_dict(self):
        fake_pool = _make_pool()
        fake_pool.stocks = {}
        with patch(
            "app.api.v1.stock.stock_service.add_to_pool",
            new=AsyncMock(return_value=fake_pool),
        ):
            app = _make_app()
            with TestClient(app) as client:
                resp = client.post(
                    "/api/v1/stocks/pool",
                    json={"pool_name": "빈 풀", "stocks": {}},
                )
        assert resp.status_code == 201


# ---------------------------------------------------------------------------
# Schema unit tests
# ---------------------------------------------------------------------------

class TestCompanyStockPoolSchemas:
    def test_pool_create_valid(self):
        from app.schemas.stock import CompanyStockPoolCreate
        obj = CompanyStockPoolCreate(
            pool_name="테스트 풀",
            stocks={"005930": {"name": "삼성전자"}},
        )
        assert obj.pool_name == "테스트 풀"
        assert "005930" in obj.stocks

    def test_pool_response_from_orm(self):
        from app.schemas.stock import CompanyStockPoolResponse
        fake = _make_pool()
        resp = CompanyStockPoolResponse.model_validate(fake)
        assert resp.id == "pool-001"
        assert resp.pool_name == "2026년 1분기 풀"
        assert "005930" in resp.stocks
