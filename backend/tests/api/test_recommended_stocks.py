"""Tests for Recommended Stocks API (P3-R5-T1).

GET /api/v1/stocks/recommendations/{rec_id}/stocks
"""
from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1.stock import router as stock_router
from app.core.deps import get_current_user
from app.models.user import User
from app.models.stock import StockRecommendation, RecommendedStock


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_NOW = datetime(2026, 3, 11, 0, 0, 0, tzinfo=timezone.utc)


def _make_user() -> User:
    user = MagicMock(spec=User)
    user.id = "user-001"
    user.is_active = True
    return user


def _make_recommendation(rec_id: str = "rec-001") -> StockRecommendation:
    obj = MagicMock(spec=StockRecommendation)
    obj.id = rec_id
    obj.user_id = "user-001"
    obj.selected_themes = {"반도체": "high"}
    obj.ai_scores = {"반도체": 90.0}
    obj.status = "completed"
    obj.created_at = _NOW
    return obj


def _make_stock(
    stock_id: str = "stock-001",
    rec_id: str = "rec-001",
    rank: int = 1,
    is_top5: bool = True,
) -> RecommendedStock:
    obj = MagicMock(spec=RecommendedStock)
    obj.id = stock_id
    obj.recommendation_id = rec_id
    obj.stock_code = "005930"
    obj.stock_name = "삼성전자"
    obj.theme = "반도체"
    obj.rank = rank
    obj.return_1m = 3.5
    obj.return_3m = 8.2
    obj.return_6m = 15.0
    obj.institutional_buy = 72.5
    obj.foreign_buy = 55.3
    obj.is_top5 = is_top5
    obj.analysis_report = "[Mock] 삼성전자 분석 리포트" if is_top5 else None
    return obj


def _make_app() -> FastAPI:
    app = FastAPI()
    app.dependency_overrides[get_current_user] = lambda: _make_user()
    app.include_router(stock_router, prefix="/api/v1")
    return app


# ---------------------------------------------------------------------------
# GET /api/v1/stocks/recommendations/{rec_id}/stocks
# ---------------------------------------------------------------------------

class TestListRecommendedStocks:
    """GET /api/v1/stocks/recommendations/{recommendation_id}/stocks"""

    def test_list_returns_200(self):
        fake_stocks = [_make_stock("s1", rank=1), _make_stock("s2", rank=2, is_top5=True)]
        with (
            patch(
                "app.api.v1.stock.stock_service.get_recommendation",
                new=AsyncMock(return_value=_make_recommendation()),
            ),
            patch(
                "app.api.v1.stock.stock_service.get_recommended_stocks",
                new=AsyncMock(return_value=fake_stocks),
            ),
        ):
            app = _make_app()
            with TestClient(app) as client:
                resp = client.get("/api/v1/stocks/recommendations/rec-001/stocks")
        assert resp.status_code == 200
        assert len(resp.json()) == 2

    def test_list_response_schema(self):
        fake_stock = _make_stock()
        with (
            patch(
                "app.api.v1.stock.stock_service.get_recommendation",
                new=AsyncMock(return_value=_make_recommendation()),
            ),
            patch(
                "app.api.v1.stock.stock_service.get_recommended_stocks",
                new=AsyncMock(return_value=[fake_stock]),
            ),
        ):
            app = _make_app()
            with TestClient(app) as client:
                resp = client.get("/api/v1/stocks/recommendations/rec-001/stocks")
        assert resp.status_code == 200
        body = resp.json()[0]
        required_fields = (
            "id", "recommendation_id", "stock_code", "stock_name",
            "theme", "rank", "is_top5",
        )
        for field in required_fields:
            assert field in body, f"Missing field: {field}"

    def test_list_recommendation_not_found_returns_404(self):
        with patch(
            "app.api.v1.stock.stock_service.get_recommendation",
            new=AsyncMock(return_value=None),
        ):
            app = _make_app()
            with TestClient(app) as client:
                resp = client.get("/api/v1/stocks/recommendations/nonexistent/stocks")
        assert resp.status_code == 404

    def test_list_requires_authentication(self):
        app_no_auth = FastAPI()
        app_no_auth.include_router(stock_router, prefix="/api/v1")
        client = TestClient(app_no_auth, raise_server_exceptions=False)
        resp = client.get("/api/v1/stocks/recommendations/rec-001/stocks")
        assert resp.status_code == 401

    def test_list_top5_have_analysis_report(self):
        fake_stocks = [
            _make_stock("s1", rank=1, is_top5=True),
            _make_stock("s2", rank=6, is_top5=False),
        ]
        with (
            patch(
                "app.api.v1.stock.stock_service.get_recommendation",
                new=AsyncMock(return_value=_make_recommendation()),
            ),
            patch(
                "app.api.v1.stock.stock_service.get_recommended_stocks",
                new=AsyncMock(return_value=fake_stocks),
            ),
        ):
            app = _make_app()
            with TestClient(app) as client:
                resp = client.get("/api/v1/stocks/recommendations/rec-001/stocks")
        assert resp.status_code == 200
        items = resp.json()
        top5 = [s for s in items if s["is_top5"]]
        non_top5 = [s for s in items if not s["is_top5"]]
        assert all(s["analysis_report"] is not None for s in top5)
        assert all(s["analysis_report"] is None for s in non_top5)

    def test_list_returns_all_return_rate_fields(self):
        fake_stock = _make_stock()
        with (
            patch(
                "app.api.v1.stock.stock_service.get_recommendation",
                new=AsyncMock(return_value=_make_recommendation()),
            ),
            patch(
                "app.api.v1.stock.stock_service.get_recommended_stocks",
                new=AsyncMock(return_value=[fake_stock]),
            ),
        ):
            app = _make_app()
            with TestClient(app) as client:
                resp = client.get("/api/v1/stocks/recommendations/rec-001/stocks")
        body = resp.json()[0]
        assert "return_1m" in body
        assert "return_3m" in body
        assert "return_6m" in body
        assert "institutional_buy" in body
        assert "foreign_buy" in body


# ---------------------------------------------------------------------------
# Schema unit tests
# ---------------------------------------------------------------------------

class TestRecommendedStockSchemas:
    def test_stock_response_from_orm(self):
        from app.schemas.stock import RecommendedStockResponse
        fake = _make_stock()
        resp = RecommendedStockResponse.model_validate(fake)
        assert resp.stock_code == "005930"
        assert resp.stock_name == "삼성전자"
        assert resp.is_top5 is True
        assert resp.rank == 1
