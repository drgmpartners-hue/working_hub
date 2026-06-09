"""Tests for Stock Screening API (P5-R4).

GET /api/v1/stocks/screening
"""
from __future__ import annotations

from unittest.mock import MagicMock
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1.stock import router as stock_router
from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.user import User


def _make_user() -> User:
    user = MagicMock(spec=User)
    user.id = "user-001"
    user.is_active = True
    return user


class _NullResult:
    def scalar(self):
        return None
    def scalars(self):
        return self
    def all(self):
        return []
    def scalar_one_or_none(self):
        return None


class _FakeSession:
    """metrics 미적재(scalar→None) → mock 폴백 유도."""
    async def execute(self, *a, **k):
        return _NullResult()
    async def get(self, *a, **k):
        return None
    async def commit(self):
        return None


async def _fake_db():
    yield _FakeSession()


def _make_app() -> FastAPI:
    app = FastAPI()
    app.dependency_overrides[get_current_user] = lambda: _make_user()
    app.dependency_overrides[get_db] = _fake_db
    app.include_router(stock_router, prefix="/api/v1")
    return app


class TestStockScreening:
    """GET /api/v1/stocks/screening"""

    def test_returns_200(self):
        app = _make_app()
        with TestClient(app) as client:
            resp = client.get("/api/v1/stocks/screening")
        assert resp.status_code == 200

    def test_returns_list(self):
        app = _make_app()
        with TestClient(app) as client:
            resp = client.get("/api/v1/stocks/screening")
        body = resp.json()
        assert isinstance(body, list)
        assert len(body) > 0

    def test_each_item_has_required_fields(self):
        app = _make_app()
        with TestClient(app) as client:
            resp = client.get("/api/v1/stocks/screening")
        body = resp.json()
        required = (
            "stock_code", "stock_name", "theme", "pbr", "per",
            "composite_score", "signal_tags", "ma_alignment",
            "return_1m", "return_3m", "return_6m", "is_top5", "allocation_pct"
        )
        for item in body:
            for field in required:
                assert field in item, f"Missing field: {field}"

    def test_signal_tags_is_list(self):
        app = _make_app()
        with TestClient(app) as client:
            resp = client.get("/api/v1/stocks/screening")
        for item in resp.json():
            assert isinstance(item["signal_tags"], list)

    def test_filter_pbr_max(self):
        """pbr_max 필터 적용 시 PBR 초과 종목 제외"""
        app = _make_app()
        with TestClient(app) as client:
            resp = client.get("/api/v1/stocks/screening?pbr_max=1.5")
        body = resp.json()
        for item in body:
            assert item["pbr"] <= 1.5, f"PBR {item['pbr']} exceeds max 1.5"

    def test_filter_score_min(self):
        """score_min 필터 적용 시 낮은 점수 종목 제외"""
        app = _make_app()
        with TestClient(app) as client:
            resp = client.get("/api/v1/stocks/screening?score_min=60")
        body = resp.json()
        for item in body:
            assert item["composite_score"] >= 60, (
                f"score {item['composite_score']} is below min 60"
            )

    def test_filter_ma_alignment(self):
        """ma_alignment 필터 적용 시 해당 값만 반환"""
        app = _make_app()
        with TestClient(app) as client:
            resp = client.get("/api/v1/stocks/screening?ma_alignment=bullish")
        body = resp.json()
        for item in body:
            assert item["ma_alignment"] == "bullish"

    def test_filter_combined(self):
        """복수 필터 동시 적용"""
        app = _make_app()
        with TestClient(app) as client:
            resp = client.get(
                "/api/v1/stocks/screening?pbr_max=2.0&score_min=50&ma_alignment=bullish"
            )
        body = resp.json()
        for item in body:
            assert item["pbr"] <= 2.0
            assert item["composite_score"] >= 50
            assert item["ma_alignment"] == "bullish"

    def test_filter_no_match_returns_empty(self):
        """존재하지 않는 조건 → 빈 리스트"""
        app = _make_app()
        with TestClient(app) as client:
            resp = client.get("/api/v1/stocks/screening?score_min=999")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_requires_authentication(self):
        from app.api.v1.stock import router as stock_router_inner
        app_no_auth = FastAPI()
        app_no_auth.include_router(stock_router_inner, prefix="/api/v1")
        client = TestClient(app_no_auth, raise_server_exceptions=False)
        resp = client.get("/api/v1/stocks/screening")
        assert resp.status_code == 401
