"""Tests for Portfolio Items API (P3-R2-T1).

GET /api/v1/portfolios/{analysis_id}/items
PUT /api/v1/portfolios/{analysis_id}/items/{item_id}
"""
from __future__ import annotations

import pytest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1.portfolio import router as portfolio_router
from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.models.portfolio import PortfolioAnalysis, PortfolioItem


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_NOW = datetime(2026, 3, 11, 0, 0, 0, tzinfo=timezone.utc)


def _make_user(user_id: str = "user-001") -> User:
    user = MagicMock(spec=User)
    user.id = user_id
    user.is_active = True
    return user


def _make_analysis(analysis_id: str = "analysis-001", user_id: str = "user-001") -> PortfolioAnalysis:
    obj = MagicMock(spec=PortfolioAnalysis)
    obj.id = analysis_id
    obj.user_id = user_id
    obj.data_source = "excel_upload"
    obj.raw_data = {}
    obj.template_data = None
    obj.ai_analysis = None
    obj.rebalancing_suggestions = None
    obj.report_file_path = None
    obj.status = "pending"
    obj.created_at = _NOW
    return obj


def _make_item(
    item_id: str = "item-001",
    analysis_id: str = "analysis-001",
    product_name: str = "삼성전자 펀드",
    product_type: str = "주식형",
) -> PortfolioItem:
    obj = MagicMock(spec=PortfolioItem)
    obj.id = item_id
    obj.analysis_id = analysis_id
    obj.product_name = product_name
    obj.product_type = product_type
    obj.current_value = 1000000.0
    obj.return_rate = 5.5
    obj.details = None
    return obj


def _make_app() -> FastAPI:
    app = FastAPI()
    fake_user = _make_user()
    app.dependency_overrides[get_current_user] = lambda: fake_user
    app.include_router(portfolio_router, prefix="/api/v1")
    return app


# ---------------------------------------------------------------------------
# GET /api/v1/portfolios/{analysis_id}/items
# ---------------------------------------------------------------------------

class TestListPortfolioItems:
    """GET /api/v1/portfolios/{analysis_id}/items"""

    def test_list_items_returns_200(self):
        from unittest.mock import patch
        fake_items = [_make_item("i1"), _make_item("i2")]
        with (
            patch(
                "app.api.v1.portfolio.portfolio_service.get_analysis",
                new=AsyncMock(return_value=_make_analysis()),
            ),
            patch(
                "app.api.v1.portfolio.portfolio_service.get_items",
                new=AsyncMock(return_value=fake_items),
            ),
        ):
            app = _make_app()
            with TestClient(app) as client:
                resp = client.get("/api/v1/portfolios/analysis-001/items")
        assert resp.status_code == 200
        assert len(resp.json()) == 2

    def test_list_items_response_schema(self):
        from unittest.mock import patch
        fake_item = _make_item()
        with (
            patch(
                "app.api.v1.portfolio.portfolio_service.get_analysis",
                new=AsyncMock(return_value=_make_analysis()),
            ),
            patch(
                "app.api.v1.portfolio.portfolio_service.get_items",
                new=AsyncMock(return_value=[fake_item]),
            ),
        ):
            app = _make_app()
            with TestClient(app) as client:
                resp = client.get("/api/v1/portfolios/analysis-001/items")
        assert resp.status_code == 200
        body = resp.json()[0]
        for field in ("id", "analysis_id", "product_name", "product_type", "current_value", "return_rate"):
            assert field in body, f"Missing field: {field}"

    def test_list_items_analysis_not_found_returns_404(self):
        from unittest.mock import patch
        with patch(
            "app.api.v1.portfolio.portfolio_service.get_analysis",
            new=AsyncMock(return_value=None),
        ):
            app = _make_app()
            with TestClient(app) as client:
                resp = client.get("/api/v1/portfolios/nonexistent/items")
        assert resp.status_code == 404

    def test_list_items_requires_authentication(self):
        app_no_auth = FastAPI()
        app_no_auth.include_router(portfolio_router, prefix="/api/v1")
        client = TestClient(app_no_auth, raise_server_exceptions=False)
        resp = client.get("/api/v1/portfolios/analysis-001/items")
        assert resp.status_code == 401

    def test_list_items_empty_list(self):
        from unittest.mock import patch
        with (
            patch(
                "app.api.v1.portfolio.portfolio_service.get_analysis",
                new=AsyncMock(return_value=_make_analysis()),
            ),
            patch(
                "app.api.v1.portfolio.portfolio_service.get_items",
                new=AsyncMock(return_value=[]),
            ),
        ):
            app = _make_app()
            with TestClient(app) as client:
                resp = client.get("/api/v1/portfolios/analysis-001/items")
        assert resp.status_code == 200
        assert resp.json() == []


# ---------------------------------------------------------------------------
# PUT /api/v1/portfolios/{analysis_id}/items/{item_id}
# ---------------------------------------------------------------------------

class TestUpdatePortfolioItem:
    """PUT /api/v1/portfolios/{analysis_id}/items/{item_id}"""

    def test_update_item_returns_200(self):
        from unittest.mock import patch
        updated_item = _make_item()
        updated_item.product_name = "업데이트된 펀드"
        with (
            patch(
                "app.api.v1.portfolio.portfolio_service.get_analysis",
                new=AsyncMock(return_value=_make_analysis()),
            ),
            patch(
                "app.api.v1.portfolio.portfolio_service.update_item",
                new=AsyncMock(return_value=updated_item),
            ),
        ):
            app = _make_app()
            with TestClient(app) as client:
                resp = client.put(
                    "/api/v1/portfolios/analysis-001/items/item-001",
                    json={"product_name": "업데이트된 펀드"},
                )
        assert resp.status_code == 200
        assert resp.json()["product_name"] == "업데이트된 펀드"

    def test_update_item_analysis_not_found_returns_404(self):
        from unittest.mock import patch
        with patch(
            "app.api.v1.portfolio.portfolio_service.get_analysis",
            new=AsyncMock(return_value=None),
        ):
            app = _make_app()
            with TestClient(app) as client:
                resp = client.put(
                    "/api/v1/portfolios/nonexistent/items/item-001",
                    json={"product_name": "test"},
                )
        assert resp.status_code == 404

    def test_update_item_item_not_found_returns_404(self):
        from unittest.mock import patch
        with (
            patch(
                "app.api.v1.portfolio.portfolio_service.get_analysis",
                new=AsyncMock(return_value=_make_analysis()),
            ),
            patch(
                "app.api.v1.portfolio.portfolio_service.update_item",
                new=AsyncMock(return_value=None),
            ),
        ):
            app = _make_app()
            with TestClient(app) as client:
                resp = client.put(
                    "/api/v1/portfolios/analysis-001/items/nonexistent",
                    json={"product_name": "test"},
                )
        assert resp.status_code == 404

    def test_update_item_requires_authentication(self):
        app_no_auth = FastAPI()
        app_no_auth.include_router(portfolio_router, prefix="/api/v1")
        client = TestClient(app_no_auth, raise_server_exceptions=False)
        resp = client.put(
            "/api/v1/portfolios/analysis-001/items/item-001",
            json={"product_name": "test"},
        )
        assert resp.status_code == 401

    def test_update_item_partial_fields(self):
        from unittest.mock import patch
        updated_item = _make_item()
        updated_item.current_value = 2000000.0
        updated_item.return_rate = 10.0
        with (
            patch(
                "app.api.v1.portfolio.portfolio_service.get_analysis",
                new=AsyncMock(return_value=_make_analysis()),
            ),
            patch(
                "app.api.v1.portfolio.portfolio_service.update_item",
                new=AsyncMock(return_value=updated_item),
            ),
        ):
            app = _make_app()
            with TestClient(app) as client:
                resp = client.put(
                    "/api/v1/portfolios/analysis-001/items/item-001",
                    json={"current_value": 2000000.0, "return_rate": 10.0},
                )
        assert resp.status_code == 200
        body = resp.json()
        assert body["current_value"] == 2000000.0
        assert body["return_rate"] == 10.0


# ---------------------------------------------------------------------------
# Schema unit tests
# ---------------------------------------------------------------------------

class TestPortfolioItemSchemas:
    def test_item_response_from_orm(self):
        from app.schemas.portfolio import PortfolioItemResponse
        fake = _make_item()
        resp = PortfolioItemResponse.model_validate(fake)
        assert resp.id == "item-001"
        assert resp.product_name == "삼성전자 펀드"
        assert resp.current_value == 1000000.0

    def test_item_update_empty_is_valid(self):
        from app.schemas.portfolio import PortfolioItemUpdate
        obj = PortfolioItemUpdate()
        assert obj.product_name is None
        assert obj.return_rate is None
