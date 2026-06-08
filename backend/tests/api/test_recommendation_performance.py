"""Tests for Recommendation Performance API (P5-R6).

GET /api/v1/stocks/performance
GET /api/v1/stocks/performance/summary
"""
from __future__ import annotations

from unittest.mock import MagicMock
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1.stock import router as stock_router
from app.core.deps import get_current_user
from app.models.user import User


def _make_user() -> User:
    user = MagicMock(spec=User)
    user.id = "user-001"
    user.is_active = True
    return user


def _make_app() -> FastAPI:
    app = FastAPI()
    app.dependency_overrides[get_current_user] = lambda: _make_user()
    app.include_router(stock_router, prefix="/api/v1")
    return app


class TestRecommendationPerformanceList:
    """GET /api/v1/stocks/performance"""

    def test_returns_200(self):
        app = _make_app()
        with TestClient(app) as client:
            resp = client.get("/api/v1/stocks/performance")
        assert resp.status_code == 200

    def test_returns_list(self):
        app = _make_app()
        with TestClient(app) as client:
            resp = client.get("/api/v1/stocks/performance")
        body = resp.json()
        assert isinstance(body, list)
        assert len(body) > 0

    def test_each_item_has_required_fields(self):
        app = _make_app()
        with TestClient(app) as client:
            resp = client.get("/api/v1/stocks/performance")
        required = (
            "recommendation_id", "stock_code", "stock_name", "theme",
            "recommended_date", "recommended_price", "current_price",
            "return_since", "benchmark_return", "excess_return",
            "holding_days", "status", "composite_score_at_rec",
        )
        for item in resp.json():
            for field in required:
                assert field in item, f"Missing field: {field}"

    def test_status_values_valid(self):
        """status ∈ {hit, miss, holding}"""
        app = _make_app()
        with TestClient(app) as client:
            resp = client.get("/api/v1/stocks/performance")
        valid = {"hit", "miss", "holding"}
        for item in resp.json():
            assert item["status"] in valid, f"Invalid status: {item['status']}"

    def test_filter_by_theme(self):
        """theme 필터: 해당 테마 종목만 반환"""
        app = _make_app()
        with TestClient(app) as client:
            resp = client.get("/api/v1/stocks/performance?theme=반도체")
        for item in resp.json():
            assert item["theme"] == "반도체"

    def test_filter_by_status(self):
        """status 필터"""
        app = _make_app()
        with TestClient(app) as client:
            resp = client.get("/api/v1/stocks/performance?status=hit")
        for item in resp.json():
            assert item["status"] == "hit"

    def test_filter_by_period(self):
        """period 필터: 응답은 200이어야 함"""
        app = _make_app()
        with TestClient(app) as client:
            resp = client.get("/api/v1/stocks/performance?period=3m")
        assert resp.status_code == 200

    def test_combined_filters(self):
        app = _make_app()
        with TestClient(app) as client:
            resp = client.get("/api/v1/stocks/performance?status=holding&period=6m")
        assert resp.status_code == 200
        for item in resp.json():
            assert item["status"] == "holding"

    def test_requires_authentication(self):
        from app.api.v1.stock import router as stock_router_inner
        app_no_auth = FastAPI()
        app_no_auth.include_router(stock_router_inner, prefix="/api/v1")
        client = TestClient(app_no_auth, raise_server_exceptions=False)
        resp = client.get("/api/v1/stocks/performance")
        assert resp.status_code == 401


class TestRecommendationPerformanceSummary:
    """GET /api/v1/stocks/performance/summary"""

    def test_returns_200(self):
        app = _make_app()
        with TestClient(app) as client:
            resp = client.get("/api/v1/stocks/performance/summary")
        assert resp.status_code == 200

    def test_response_has_required_fields(self):
        app = _make_app()
        with TestClient(app) as client:
            resp = client.get("/api/v1/stocks/performance/summary")
        body = resp.json()
        required = (
            "hit_rate", "avg_excess_return", "tracked_count",
            "avg_holding_days", "status_distribution",
        )
        for field in required:
            assert field in body, f"Missing field: {field}"

    def test_status_distribution_has_all_statuses(self):
        app = _make_app()
        with TestClient(app) as client:
            resp = client.get("/api/v1/stocks/performance/summary")
        dist = resp.json()["status_distribution"]
        for key in ("hit", "miss", "holding"):
            assert key in dist, f"Missing status_distribution.{key}"

    def test_hit_rate_in_valid_range(self):
        app = _make_app()
        with TestClient(app) as client:
            resp = client.get("/api/v1/stocks/performance/summary")
        hit_rate = resp.json()["hit_rate"]
        assert 0.0 <= hit_rate <= 1.0

    def test_tracked_count_positive(self):
        app = _make_app()
        with TestClient(app) as client:
            resp = client.get("/api/v1/stocks/performance/summary")
        assert resp.json()["tracked_count"] > 0

    def test_requires_authentication(self):
        from app.api.v1.stock import router as stock_router_inner
        app_no_auth = FastAPI()
        app_no_auth.include_router(stock_router_inner, prefix="/api/v1")
        client = TestClient(app_no_auth, raise_server_exceptions=False)
        resp = client.get("/api/v1/stocks/performance/summary")
        assert resp.status_code == 401
