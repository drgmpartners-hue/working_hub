"""Tests for Stock Themes API (P3-R3-T1).

GET  /api/v1/stocks/themes
POST /api/v1/stocks/themes/analyze
"""
from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1.stock import router as stock_router
from app.core.deps import get_current_user
from app.models.user import User
from app.models.stock import StockTheme


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_NOW = datetime(2026, 3, 11, 0, 0, 0, tzinfo=timezone.utc)


def _make_user() -> User:
    user = MagicMock(spec=User)
    user.id = "user-001"
    user.is_active = True
    return user


def _make_theme(
    theme_id: str = "theme-001",
    theme_name: str = "반도체",
    ai_score: float | None = None,
) -> StockTheme:
    obj = MagicMock(spec=StockTheme)
    obj.id = theme_id
    obj.theme_name = theme_name
    obj.ai_score = ai_score
    obj.news_summary = None
    obj.stock_count = 10
    obj.updated_at = _NOW
    return obj


def _make_app() -> FastAPI:
    app = FastAPI()
    app.dependency_overrides[get_current_user] = lambda: _make_user()
    app.include_router(stock_router, prefix="/api/v1")
    return app


# ---------------------------------------------------------------------------
# GET /api/v1/stocks/themes
# ---------------------------------------------------------------------------

class TestListStockThemes:
    """GET /api/v1/stocks/themes"""

    def test_list_returns_200(self):
        fake_themes = [_make_theme("t1", "반도체"), _make_theme("t2", "바이오")]
        with patch(
            "app.api.v1.stock.stock_service.get_themes",
            new=AsyncMock(return_value=fake_themes),
        ):
            app = _make_app()
            with TestClient(app) as client:
                resp = client.get("/api/v1/stocks/themes")
        assert resp.status_code == 200
        assert len(resp.json()) == 2

    def test_list_response_schema(self):
        fake_theme = _make_theme()
        with patch(
            "app.api.v1.stock.stock_service.get_themes",
            new=AsyncMock(return_value=[fake_theme]),
        ):
            app = _make_app()
            with TestClient(app) as client:
                resp = client.get("/api/v1/stocks/themes")
        assert resp.status_code == 200
        body = resp.json()[0]
        for field in ("id", "theme_name", "stock_count", "updated_at"):
            assert field in body, f"Missing field: {field}"

    def test_list_requires_authentication(self):
        app_no_auth = FastAPI()
        app_no_auth.include_router(stock_router, prefix="/api/v1")
        client = TestClient(app_no_auth, raise_server_exceptions=False)
        resp = client.get("/api/v1/stocks/themes")
        assert resp.status_code == 401

    def test_list_empty_returns_empty_list(self):
        with patch(
            "app.api.v1.stock.stock_service.get_themes",
            new=AsyncMock(return_value=[]),
        ):
            app = _make_app()
            with TestClient(app) as client:
                resp = client.get("/api/v1/stocks/themes")
        assert resp.status_code == 200
        assert resp.json() == []


# ---------------------------------------------------------------------------
# POST /api/v1/stocks/themes/analyze
# ---------------------------------------------------------------------------

class TestAnalyzeStockThemes:
    """POST /api/v1/stocks/themes/analyze"""

    def test_analyze_returns_200(self):
        analyzed = [_make_theme(ai_score=87.5)]
        with patch(
            "app.api.v1.stock.stock_service.analyze_themes",
            new=AsyncMock(return_value=analyzed),
        ):
            app = _make_app()
            with TestClient(app) as client:
                resp = client.post(
                    "/api/v1/stocks/themes/analyze",
                    json={"theme_ids": ["theme-001"]},
                )
        assert resp.status_code == 200

    def test_analyze_response_has_ai_score(self):
        analyzed = [_make_theme(ai_score=87.5)]
        with patch(
            "app.api.v1.stock.stock_service.analyze_themes",
            new=AsyncMock(return_value=analyzed),
        ):
            app = _make_app()
            with TestClient(app) as client:
                resp = client.post(
                    "/api/v1/stocks/themes/analyze",
                    json={"theme_ids": ["theme-001"]},
                )
        assert resp.status_code == 200
        body = resp.json()
        assert len(body) == 1
        assert body[0]["ai_score"] == 87.5

    def test_analyze_empty_theme_ids_returns_400(self):
        app = _make_app()
        with TestClient(app) as client:
            resp = client.post(
                "/api/v1/stocks/themes/analyze",
                json={"theme_ids": []},
            )
        assert resp.status_code == 400

    def test_analyze_missing_theme_ids_returns_422(self):
        app = _make_app()
        with TestClient(app) as client:
            resp = client.post("/api/v1/stocks/themes/analyze", json={})
        assert resp.status_code == 422

    def test_analyze_requires_authentication(self):
        app_no_auth = FastAPI()
        app_no_auth.include_router(stock_router, prefix="/api/v1")
        client = TestClient(app_no_auth, raise_server_exceptions=False)
        resp = client.post(
            "/api/v1/stocks/themes/analyze",
            json={"theme_ids": ["theme-001"]},
        )
        assert resp.status_code == 401

    def test_analyze_multiple_themes(self):
        analyzed = [_make_theme("t1", "반도체", 92.0), _make_theme("t2", "바이오", 75.0)]
        with patch(
            "app.api.v1.stock.stock_service.analyze_themes",
            new=AsyncMock(return_value=analyzed),
        ):
            app = _make_app()
            with TestClient(app) as client:
                resp = client.post(
                    "/api/v1/stocks/themes/analyze",
                    json={"theme_ids": ["t1", "t2"]},
                )
        assert resp.status_code == 200
        assert len(resp.json()) == 2


# ---------------------------------------------------------------------------
# Schema unit tests
# ---------------------------------------------------------------------------

class TestStockThemeSchemas:
    def test_theme_response_from_orm(self):
        from app.schemas.stock import StockThemeResponse
        fake = _make_theme(ai_score=80.0)
        resp = StockThemeResponse.model_validate(fake)
        assert resp.id == "theme-001"
        assert resp.theme_name == "반도체"
        assert resp.ai_score == 80.0

    def test_analyze_request_valid(self):
        from app.schemas.stock import StockThemeAnalyzeRequest
        req = StockThemeAnalyzeRequest(theme_ids=["t1", "t2"])
        assert len(req.theme_ids) == 2

    def test_analyze_request_empty_list_valid(self):
        from app.schemas.stock import StockThemeAnalyzeRequest
        req = StockThemeAnalyzeRequest(theme_ids=[])
        assert req.theme_ids == []
