"""Tests for Portfolio Analyses API (P3-R1-T1).

POST   /api/v1/portfolios
GET    /api/v1/portfolios
GET    /api/v1/portfolios/{id}
PUT    /api/v1/portfolios/{id}

Uses a mock database and fake auth so no live PostgreSQL instance is required.
"""
from __future__ import annotations

import pytest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1.portfolio import router as portfolio_router
from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.models.portfolio import PortfolioAnalysis


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_NOW = datetime(2026, 3, 11, 0, 0, 0, tzinfo=timezone.utc)


def _make_user(user_id: str = "user-001") -> User:
    user = MagicMock(spec=User)
    user.id = user_id
    user.is_active = True
    return user


def _make_analysis(
    analysis_id: str = "analysis-001",
    user_id: str = "user-001",
    data_source: str = "excel_upload",
    status: str = "pending",
) -> PortfolioAnalysis:
    obj = MagicMock(spec=PortfolioAnalysis)
    obj.id = analysis_id
    obj.user_id = user_id
    obj.data_source = data_source
    obj.raw_data = {"key": "value"}
    obj.template_data = None
    obj.ai_analysis = None
    obj.rebalancing_suggestions = None
    obj.report_file_path = None
    obj.status = status
    obj.created_at = _NOW
    return obj


def _make_app(mock_db: AsyncMock | None = None) -> FastAPI:
    app = FastAPI()
    fake_user = _make_user()
    app.dependency_overrides[get_current_user] = lambda: fake_user
    if mock_db is not None:
        app.dependency_overrides[get_db] = lambda: mock_db
    app.include_router(portfolio_router, prefix="/api/v1")
    return app


# ---------------------------------------------------------------------------
# POST /api/v1/portfolios
# ---------------------------------------------------------------------------

class TestCreatePortfolioAnalysis:
    """POST /api/v1/portfolios"""

    def test_create_returns_201(self):
        fake_analysis = _make_analysis()
        with patch(
            "app.api.v1.portfolio.portfolio_service.create_analysis",
            new=AsyncMock(return_value=fake_analysis),
        ):
            app = _make_app()
            with TestClient(app) as client:
                resp = client.post(
                    "/api/v1/portfolios",
                    json={"data_source": "excel_upload", "raw_data": {"key": "value"}},
                )
        assert resp.status_code == 201

    def test_create_response_schema(self):
        fake_analysis = _make_analysis()
        with patch(
            "app.api.v1.portfolio.portfolio_service.create_analysis",
            new=AsyncMock(return_value=fake_analysis),
        ):
            app = _make_app()
            with TestClient(app) as client:
                resp = client.post(
                    "/api/v1/portfolios",
                    json={"data_source": "excel_upload", "raw_data": {"key": "value"}},
                )
        assert resp.status_code == 201
        body = resp.json()
        for field in ("id", "user_id", "data_source", "raw_data", "status", "created_at"):
            assert field in body, f"Missing field: {field}"
        assert body["data_source"] == "excel_upload"
        assert body["status"] == "pending"

    def test_create_requires_authentication(self):
        app_no_auth = FastAPI()
        app_no_auth.include_router(portfolio_router, prefix="/api/v1")
        client = TestClient(app_no_auth, raise_server_exceptions=False)
        resp = client.post(
            "/api/v1/portfolios",
            json={"data_source": "excel_upload", "raw_data": {}},
        )
        assert resp.status_code == 401

    def test_create_missing_data_source_returns_422(self):
        app = _make_app()
        with TestClient(app) as client:
            resp = client.post("/api/v1/portfolios", json={"raw_data": {}})
        assert resp.status_code == 422

    def test_create_missing_raw_data_returns_422(self):
        app = _make_app()
        with TestClient(app) as client:
            resp = client.post(
                "/api/v1/portfolios", json={"data_source": "excel_upload"}
            )
        assert resp.status_code == 422


# ---------------------------------------------------------------------------
# GET /api/v1/portfolios
# ---------------------------------------------------------------------------

class TestListPortfolioAnalyses:
    """GET /api/v1/portfolios"""

    def test_list_returns_200(self):
        fake_analyses = [_make_analysis("a1"), _make_analysis("a2")]
        with patch(
            "app.api.v1.portfolio.portfolio_service.get_analyses",
            new=AsyncMock(return_value=fake_analyses),
        ):
            app = _make_app()
            with TestClient(app) as client:
                resp = client.get("/api/v1/portfolios")
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)
        assert len(resp.json()) == 2

    def test_list_requires_authentication(self):
        app_no_auth = FastAPI()
        app_no_auth.include_router(portfolio_router, prefix="/api/v1")
        client = TestClient(app_no_auth, raise_server_exceptions=False)
        resp = client.get("/api/v1/portfolios")
        assert resp.status_code == 401

    def test_list_empty_returns_empty_list(self):
        with patch(
            "app.api.v1.portfolio.portfolio_service.get_analyses",
            new=AsyncMock(return_value=[]),
        ):
            app = _make_app()
            with TestClient(app) as client:
                resp = client.get("/api/v1/portfolios")
        assert resp.status_code == 200
        assert resp.json() == []


# ---------------------------------------------------------------------------
# GET /api/v1/portfolios/{id}
# ---------------------------------------------------------------------------

class TestGetPortfolioAnalysis:
    """GET /api/v1/portfolios/{analysis_id}"""

    def test_get_found_returns_200(self):
        fake_analysis = _make_analysis()
        with patch(
            "app.api.v1.portfolio.portfolio_service.get_analysis",
            new=AsyncMock(return_value=fake_analysis),
        ):
            app = _make_app()
            with TestClient(app) as client:
                resp = client.get("/api/v1/portfolios/analysis-001")
        assert resp.status_code == 200
        assert resp.json()["id"] == "analysis-001"

    def test_get_not_found_returns_404(self):
        with patch(
            "app.api.v1.portfolio.portfolio_service.get_analysis",
            new=AsyncMock(return_value=None),
        ):
            app = _make_app()
            with TestClient(app) as client:
                resp = client.get("/api/v1/portfolios/nonexistent")
        assert resp.status_code == 404

    def test_get_requires_authentication(self):
        app_no_auth = FastAPI()
        app_no_auth.include_router(portfolio_router, prefix="/api/v1")
        client = TestClient(app_no_auth, raise_server_exceptions=False)
        resp = client.get("/api/v1/portfolios/analysis-001")
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# PUT /api/v1/portfolios/{id}
# ---------------------------------------------------------------------------

class TestUpdatePortfolioAnalysis:
    """PUT /api/v1/portfolios/{analysis_id}"""

    def test_update_returns_200(self):
        fake_analysis = _make_analysis(status="completed")
        with patch(
            "app.api.v1.portfolio.portfolio_service.update_analysis",
            new=AsyncMock(return_value=fake_analysis),
        ):
            app = _make_app()
            with TestClient(app) as client:
                resp = client.put(
                    "/api/v1/portfolios/analysis-001",
                    json={"status": "completed"},
                )
        assert resp.status_code == 200
        assert resp.json()["status"] == "completed"

    def test_update_not_found_returns_404(self):
        with patch(
            "app.api.v1.portfolio.portfolio_service.update_analysis",
            new=AsyncMock(return_value=None),
        ):
            app = _make_app()
            with TestClient(app) as client:
                resp = client.put(
                    "/api/v1/portfolios/nonexistent",
                    json={"status": "completed"},
                )
        assert resp.status_code == 404

    def test_update_requires_authentication(self):
        app_no_auth = FastAPI()
        app_no_auth.include_router(portfolio_router, prefix="/api/v1")
        client = TestClient(app_no_auth, raise_server_exceptions=False)
        resp = client.put(
            "/api/v1/portfolios/analysis-001",
            json={"status": "completed"},
        )
        assert resp.status_code == 401

    def test_update_partial_fields(self):
        fake_analysis = _make_analysis()
        fake_analysis.report_file_path = "/some/path/report.pdf"
        with patch(
            "app.api.v1.portfolio.portfolio_service.update_analysis",
            new=AsyncMock(return_value=fake_analysis),
        ):
            app = _make_app()
            with TestClient(app) as client:
                resp = client.put(
                    "/api/v1/portfolios/analysis-001",
                    json={"report_file_path": "/some/path/report.pdf"},
                )
        assert resp.status_code == 200
        assert resp.json()["report_file_path"] == "/some/path/report.pdf"


# ---------------------------------------------------------------------------
# Schema unit tests
# ---------------------------------------------------------------------------

class TestPortfolioSchemas:
    """Pydantic schema validation."""

    def test_analysis_create_valid(self):
        from app.schemas.portfolio import PortfolioAnalysisCreate
        obj = PortfolioAnalysisCreate(
            data_source="excel_upload", raw_data={"sheet1": []}
        )
        assert obj.data_source == "excel_upload"

    def test_analysis_update_all_optional(self):
        from app.schemas.portfolio import PortfolioAnalysisUpdate
        obj = PortfolioAnalysisUpdate()
        assert obj.status is None
        assert obj.ai_analysis is None

    def test_analysis_response_from_orm(self):
        from app.schemas.portfolio import PortfolioAnalysisResponse
        fake = _make_analysis()
        resp = PortfolioAnalysisResponse.model_validate(fake)
        assert resp.id == "analysis-001"
        assert resp.status == "pending"

    def test_item_update_all_optional(self):
        from app.schemas.portfolio import PortfolioItemUpdate
        obj = PortfolioItemUpdate()
        assert obj.product_name is None
        assert obj.current_value is None
