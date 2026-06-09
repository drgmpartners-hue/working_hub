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


# ---------------------------------------------------------------------------
# POST /api/v1/stocks/themes/refresh (테마 반영)
# ---------------------------------------------------------------------------

class TestRefreshStockThemes:
    """POST /api/v1/stocks/themes/refresh"""

    def test_refresh_returns_200_with_themes(self):
        populated = [
            _make_theme("t1", "AI반도체·HBM", ai_score=94.2),
            _make_theme("t2", "방산", ai_score=86.1),
        ]
        with patch(
            "app.api.v1.stock.stock_service.populate_themes",
            new=AsyncMock(return_value=populated),
        ):
            app = _make_app()
            with TestClient(app) as client:
                resp = client.post("/api/v1/stocks/themes/refresh")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body) == 2
        assert body[0]["theme_name"] == "AI반도체·HBM"

    def test_refresh_requires_authentication(self):
        app_no_auth = FastAPI()
        app_no_auth.include_router(stock_router, prefix="/api/v1")
        client = TestClient(app_no_auth, raise_server_exceptions=False)
        resp = client.post("/api/v1/stocks/themes/refresh")
        assert resp.status_code == 401

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


# ---------------------------------------------------------------------------
# GET /api/v1/stocks/themes/{id}/score  (5축 집계)
# ---------------------------------------------------------------------------

class _FakeTheme:
    theme_name = "방산"
    ai_score = 80.0


class _FakeSession:
    async def get(self, model, _id):
        return _FakeTheme()
    async def commit(self):
        return None


async def _fake_db_session():
    yield _FakeSession()


class TestThemeScore:
    """GET /api/v1/stocks/themes/{id}/score"""

    def _app(self):
        from app.db.session import get_db
        app = FastAPI()
        app.dependency_overrides[get_current_user] = lambda: _make_user()
        app.dependency_overrides[get_db] = _fake_db_session
        app.include_router(stock_router, prefix="/api/v1")
        return app

    def test_score_live_aggregation(self):
        agg = {
            "score": 43.3, "phase": "turnaround",
            "axes": {"momentum": 2.2, "supply": 55.0, "fundamentals": 86.4, "attention": 100.0, "valuation": 0.0},
            "weights": {"momentum": 0.3, "supply": 0.4, "fundamentals": 0.1, "attention": 0.12, "valuation": 0.08},
            "members": [{"code": "012450", "phase": "turnaround", "score": 50.0}],
            "data_source": "live",
        }
        with patch("app.api.v1.stock.theme_scoring.aggregate_theme", new=AsyncMock(return_value=agg)):
            with TestClient(self._app()) as client:
                resp = client.get("/api/v1/stocks/themes/t1/score")
        assert resp.status_code == 200
        body = resp.json()
        assert body["phase"] == "turnaround"
        assert body["axes"]["fundamentals"] == 86.4
        assert body["data_source"] == "live"

    def test_score_placeholder_fallback(self):
        """매핑/실데이터 없음 → mock 폴백, 200."""
        with patch("app.api.v1.stock.theme_scoring.aggregate_theme", new=AsyncMock(return_value=None)):
            with TestClient(self._app()) as client:
                resp = client.get("/api/v1/stocks/themes/t1/score")
        assert resp.status_code == 200
        assert resp.json()["data_source"] == "mock"


# ---------------------------------------------------------------------------
# 사후검증 가중치 보정
# ---------------------------------------------------------------------------

class TestCalibration:
    """GET /calibration/report, POST /calibration/apply"""

    def _app(self):
        from app.db.session import get_db
        app = FastAPI()
        app.dependency_overrides[get_current_user] = lambda: _make_user()
        app.dependency_overrides[get_db] = _fake_db_session
        app.include_router(stock_router, prefix="/api/v1")
        return app

    _REPORT = {
        "sample_codes": 12, "pairs": 576, "horizon": 20,
        "r_momentum": -0.0936, "momentum_factor": 0.86,
        "current_weights": {"neutral": {"momentum": 0.3}, "breakout": {}, "turnaround": {}},
        "proposed_weights": {"neutral": {"momentum": 0.27}, "breakout": {}, "turnaround": {}},
        "data_source": "live", "note": "ok",
    }

    def test_report_200(self):
        with patch("app.api.v1.stock.weight_calibration.run_calibration", new=AsyncMock(return_value=self._REPORT)):
            with TestClient(self._app()) as client:
                resp = client.get("/api/v1/stocks/calibration/report")
        assert resp.status_code == 200
        body = resp.json()
        assert body["r_momentum"] == -0.0936
        assert body["applied"] is False

    def test_apply_persists(self):
        with patch("app.api.v1.stock.weight_calibration.run_calibration", new=AsyncMock(return_value=self._REPORT)), \
             patch("app.api.v1.stock.weight_calibration.apply_weights") as mock_apply:
            with TestClient(self._app()) as client:
                resp = client.post("/api/v1/stocks/calibration/apply")
        assert resp.status_code == 200
        assert resp.json()["applied"] is True
        mock_apply.assert_called_once()


# ---------------------------------------------------------------------------
# POST /api/v1/stocks/themes/collect (역설계 수집)
# ---------------------------------------------------------------------------

class TestCollectMapping:
    """POST /themes/collect"""

    def _app(self):
        from app.db.session import get_db
        app = FastAPI()
        app.dependency_overrides[get_current_user] = lambda: _make_user()
        app.dependency_overrides[get_db] = _fake_db_session
        app.include_router(stock_router, prefix="/api/v1")
        return app

    def test_collect_200(self):
        mapping = {"HBM(고대역폭메모리)": [["089030", "테크윙"], ["451220", "아이엠티"]], "2차전지": [["373220", "LG에너지솔루션"]]}
        with patch("app.api.v1.stock.theme_mapping_collector.collect", new=AsyncMock(return_value=mapping)), \
             patch("app.api.v1.stock.stock_service.upsert_themes_from_mapping", new=AsyncMock(return_value=2)):
            with TestClient(self._app()) as client:
                resp = client.post("/api/v1/stocks/themes/collect?max_pages=1")
        assert resp.status_code == 200
        body = resp.json()
        assert body["collected_themes"] == 2
        assert body["new_themes"] == 2
        assert body["total_members"] == 3
