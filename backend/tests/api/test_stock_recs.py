"""Tests for Stock Recommendations API (P3-R4-T1).

POST /api/v1/stocks/recommendations
GET  /api/v1/stocks/recommendations/{id}
"""
from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1.stock import router as stock_router
from app.core.deps import get_current_user
from app.models.user import User
from app.models.stock import StockRecommendation


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_NOW = datetime(2026, 3, 11, 0, 0, 0, tzinfo=timezone.utc)


def _make_user() -> User:
    user = MagicMock(spec=User)
    user.id = "user-001"
    user.is_active = True
    return user


def _make_recommendation(
    rec_id: str = "rec-001",
    user_id: str = "user-001",
    status: str = "completed",
) -> StockRecommendation:
    obj = MagicMock(spec=StockRecommendation)
    obj.id = rec_id
    obj.user_id = user_id
    obj.selected_themes = {"반도체": "high", "바이오": "medium"}
    obj.ai_scores = {"반도체": 87.5, "바이오": 72.0}
    obj.status = status
    obj.created_at = _NOW
    return obj


def _make_app() -> FastAPI:
    app = FastAPI()
    app.dependency_overrides[get_current_user] = lambda: _make_user()
    app.include_router(stock_router, prefix="/api/v1")
    return app


# ---------------------------------------------------------------------------
# POST /api/v1/stocks/recommendations
# ---------------------------------------------------------------------------

class TestCreateStockRecommendation:
    """POST /api/v1/stocks/recommendations"""

    def test_create_returns_201(self):
        fake_rec = _make_recommendation()
        with patch(
            "app.api.v1.stock.stock_service.create_recommendation",
            new=AsyncMock(return_value=fake_rec),
        ):
            app = _make_app()
            with TestClient(app) as client:
                resp = client.post(
                    "/api/v1/stocks/recommendations",
                    json={"selected_themes": {"반도체": "high"}},
                )
        assert resp.status_code == 201

    def test_create_response_schema(self):
        fake_rec = _make_recommendation()
        with patch(
            "app.api.v1.stock.stock_service.create_recommendation",
            new=AsyncMock(return_value=fake_rec),
        ):
            app = _make_app()
            with TestClient(app) as client:
                resp = client.post(
                    "/api/v1/stocks/recommendations",
                    json={"selected_themes": {"반도체": "high"}},
                )
        assert resp.status_code == 201
        body = resp.json()
        for field in ("id", "user_id", "selected_themes", "status", "created_at"):
            assert field in body, f"Missing field: {field}"
        assert body["status"] == "completed"

    def test_create_missing_selected_themes_returns_422(self):
        app = _make_app()
        with TestClient(app) as client:
            resp = client.post("/api/v1/stocks/recommendations", json={})
        assert resp.status_code == 422

    def test_create_requires_authentication(self):
        app_no_auth = FastAPI()
        app_no_auth.include_router(stock_router, prefix="/api/v1")
        client = TestClient(app_no_auth, raise_server_exceptions=False)
        resp = client.post(
            "/api/v1/stocks/recommendations",
            json={"selected_themes": {"반도체": "high"}},
        )
        assert resp.status_code == 401

    def test_create_has_ai_scores(self):
        fake_rec = _make_recommendation()
        with patch(
            "app.api.v1.stock.stock_service.create_recommendation",
            new=AsyncMock(return_value=fake_rec),
        ):
            app = _make_app()
            with TestClient(app) as client:
                resp = client.post(
                    "/api/v1/stocks/recommendations",
                    json={"selected_themes": {"반도체": "high", "바이오": "medium"}},
                )
        assert resp.status_code == 201
        body = resp.json()
        assert body["ai_scores"] is not None


# ---------------------------------------------------------------------------
# GET /api/v1/stocks/recommendations/{id}
# ---------------------------------------------------------------------------

class TestGetStockRecommendation:
    """GET /api/v1/stocks/recommendations/{recommendation_id}"""

    def test_get_found_returns_200(self):
        fake_rec = _make_recommendation()
        with patch(
            "app.api.v1.stock.stock_service.get_recommendation",
            new=AsyncMock(return_value=fake_rec),
        ):
            app = _make_app()
            with TestClient(app) as client:
                resp = client.get("/api/v1/stocks/recommendations/rec-001")
        assert resp.status_code == 200
        assert resp.json()["id"] == "rec-001"

    def test_get_not_found_returns_404(self):
        with patch(
            "app.api.v1.stock.stock_service.get_recommendation",
            new=AsyncMock(return_value=None),
        ):
            app = _make_app()
            with TestClient(app) as client:
                resp = client.get("/api/v1/stocks/recommendations/nonexistent")
        assert resp.status_code == 404

    def test_get_requires_authentication(self):
        app_no_auth = FastAPI()
        app_no_auth.include_router(stock_router, prefix="/api/v1")
        client = TestClient(app_no_auth, raise_server_exceptions=False)
        resp = client.get("/api/v1/stocks/recommendations/rec-001")
        assert resp.status_code == 401

    def test_get_response_has_all_fields(self):
        fake_rec = _make_recommendation()
        with patch(
            "app.api.v1.stock.stock_service.get_recommendation",
            new=AsyncMock(return_value=fake_rec),
        ):
            app = _make_app()
            with TestClient(app) as client:
                resp = client.get("/api/v1/stocks/recommendations/rec-001")
        body = resp.json()
        for field in ("id", "user_id", "selected_themes", "ai_scores", "status", "created_at"):
            assert field in body, f"Missing field: {field}"


# ---------------------------------------------------------------------------
# Schema unit tests
# ---------------------------------------------------------------------------

class TestStockRecommendationSchemas:
    def test_recommendation_create_valid(self):
        from app.schemas.stock import StockRecommendationCreate
        obj = StockRecommendationCreate(selected_themes={"반도체": "high"})
        assert "반도체" in obj.selected_themes

    def test_recommendation_response_from_orm(self):
        from app.schemas.stock import StockRecommendationResponse
        fake = _make_recommendation()
        resp = StockRecommendationResponse.model_validate(fake)
        assert resp.id == "rec-001"
        assert resp.status == "completed"
        assert resp.ai_scores is not None
