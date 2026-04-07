"""Tests for wrap accounts API endpoints.

Covers:
  GET  /api/v1/retirement/wrap-accounts
  POST /api/v1/retirement/wrap-accounts
  PUT  /api/v1/retirement/wrap-accounts/{id}
  DELETE /api/v1/retirement/wrap-accounts/{id}

Strategy
--------
- No real database is required. The ``get_db`` FastAPI dependency is overridden
  to yield a ``MagicMock`` session, and DB calls are patched with ``AsyncMock``.
- ``httpx.AsyncClient`` with ``ASGITransport`` drives the ASGI app in-process.
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.wrap_accounts import router
from app.core.deps import get_current_user
from app.db.session import get_db


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_test_app(mock_db: AsyncSession, mock_user) -> FastAPI:
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_db] = lambda: mock_db
    app.dependency_overrides[get_current_user] = lambda: mock_user
    return app


def make_mock_user():
    user = MagicMock()
    user.id = "user-uuid-001"
    user.is_active = True
    return user


def make_mock_wrap_account(**kwargs):
    account = MagicMock()
    account.id = kwargs.get("id", 1)
    account.product_name = kwargs.get("product_name", "삼성 글로벌 랩")
    account.securities_company = kwargs.get("securities_company", "삼성증권")
    account.investment_target = kwargs.get("investment_target", "글로벌 주식")
    account.target_return_rate = kwargs.get("target_return_rate", Decimal("5.50"))
    account.description = kwargs.get("description", "글로벌 주식 투자 랩")
    account.is_active = kwargs.get("is_active", True)
    account.created_at = kwargs.get("created_at", datetime(2025, 1, 1))
    account.updated_at = kwargs.get("updated_at", datetime(2025, 1, 1))
    return account


# ---------------------------------------------------------------------------
# GET /api/v1/retirement/wrap-accounts
# ---------------------------------------------------------------------------

class TestListWrapAccounts:
    """Tests for GET /api/v1/retirement/wrap-accounts."""

    def test_list_returns_200_with_active_accounts(self):
        """Should return list of active wrap accounts."""
        mock_account = make_mock_wrap_account()

        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = [mock_account]

        mock_db = AsyncMock(spec=AsyncSession)
        mock_db.execute = AsyncMock(return_value=mock_result)

        mock_user = make_mock_user()
        app = make_test_app(mock_db, mock_user)

        with TestClient(app) as client:
            response = client.get("/api/v1/retirement/wrap-accounts")

        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) == 1
        assert data[0]["product_name"] == "삼성 글로벌 랩"
        assert data[0]["securities_company"] == "삼성증권"

    def test_list_with_is_active_filter(self):
        """Should filter by is_active query param."""
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = []

        mock_db = AsyncMock(spec=AsyncSession)
        mock_db.execute = AsyncMock(return_value=mock_result)

        mock_user = make_mock_user()
        app = make_test_app(mock_db, mock_user)

        with TestClient(app) as client:
            response = client.get("/api/v1/retirement/wrap-accounts?is_active=false")

        assert response.status_code == 200
        assert response.json() == []

    def test_list_returns_empty_when_no_accounts(self):
        """Should return empty list when no accounts exist."""
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = []

        mock_db = AsyncMock(spec=AsyncSession)
        mock_db.execute = AsyncMock(return_value=mock_result)

        mock_user = make_mock_user()
        app = make_test_app(mock_db, mock_user)

        with TestClient(app) as client:
            response = client.get("/api/v1/retirement/wrap-accounts")

        assert response.status_code == 200
        assert response.json() == []


# ---------------------------------------------------------------------------
# POST /api/v1/retirement/wrap-accounts
# ---------------------------------------------------------------------------

class TestCreateWrapAccount:
    """Tests for POST /api/v1/retirement/wrap-accounts."""

    def test_create_returns_201(self):
        """Should create and return a new wrap account."""
        mock_account = make_mock_wrap_account(
            id=1,
            product_name="한국 채권 랩",
            securities_company="한국투자증권",
        )

        mock_db = AsyncMock(spec=AsyncSession)
        mock_db.add = MagicMock()
        mock_db.commit = AsyncMock()
        mock_db.refresh = AsyncMock(side_effect=lambda obj: setattr(obj, "id", 1))

        mock_user = make_mock_user()
        app = make_test_app(mock_db, mock_user)

        # patch the model constructor to return mock object
        with patch("app.api.v1.wrap_accounts.WrapAccount", return_value=mock_account):
            with TestClient(app) as client:
                response = client.post(
                    "/api/v1/retirement/wrap-accounts",
                    json={
                        "product_name": "한국 채권 랩",
                        "securities_company": "한국투자증권",
                        "investment_target": "국내 채권",
                        "target_return_rate": 3.5,
                        "description": "안정적인 채권 투자",
                        "is_active": True,
                    },
                )

        assert response.status_code == 201
        mock_db.commit.assert_awaited_once()

    def test_create_requires_product_name(self):
        """Should return 422 when product_name is missing."""
        mock_db = AsyncMock(spec=AsyncSession)
        mock_user = make_mock_user()
        app = make_test_app(mock_db, mock_user)

        with TestClient(app) as client:
            response = client.post(
                "/api/v1/retirement/wrap-accounts",
                json={"securities_company": "삼성증권"},
            )

        assert response.status_code == 422

    def test_create_requires_securities_company(self):
        """Should return 422 when securities_company is missing."""
        mock_db = AsyncMock(spec=AsyncSession)
        mock_user = make_mock_user()
        app = make_test_app(mock_db, mock_user)

        with TestClient(app) as client:
            response = client.post(
                "/api/v1/retirement/wrap-accounts",
                json={"product_name": "테스트 랩"},
            )

        assert response.status_code == 422


# ---------------------------------------------------------------------------
# PUT /api/v1/retirement/wrap-accounts/{id}
# ---------------------------------------------------------------------------

class TestUpdateWrapAccount:
    """Tests for PUT /api/v1/retirement/wrap-accounts/{id}."""

    def test_update_returns_200(self):
        """Should update and return the modified wrap account."""
        mock_account = make_mock_wrap_account(id=1)

        mock_db = AsyncMock(spec=AsyncSession)
        mock_db.get = AsyncMock(return_value=mock_account)
        mock_db.commit = AsyncMock()
        mock_db.refresh = AsyncMock()

        mock_user = make_mock_user()
        app = make_test_app(mock_db, mock_user)

        with TestClient(app) as client:
            response = client.put(
                "/api/v1/retirement/wrap-accounts/1",
                json={"description": "업데이트된 설명"},
            )

        assert response.status_code == 200
        mock_db.commit.assert_awaited_once()

    def test_update_returns_404_when_not_found(self):
        """Should return 404 when account does not exist."""
        mock_db = AsyncMock(spec=AsyncSession)
        mock_db.get = AsyncMock(return_value=None)

        mock_user = make_mock_user()
        app = make_test_app(mock_db, mock_user)

        with TestClient(app) as client:
            response = client.put(
                "/api/v1/retirement/wrap-accounts/999",
                json={"description": "없는 항목"},
            )

        assert response.status_code == 404


# ---------------------------------------------------------------------------
# DELETE /api/v1/retirement/wrap-accounts/{id}
# ---------------------------------------------------------------------------

class TestDeleteWrapAccount:
    """Tests for DELETE /api/v1/retirement/wrap-accounts/{id}."""

    def test_delete_deactivates_account(self):
        """Should soft-delete (deactivate) the wrap account and return 204."""
        mock_account = make_mock_wrap_account(id=1, is_active=True)

        mock_db = AsyncMock(spec=AsyncSession)
        mock_db.get = AsyncMock(return_value=mock_account)
        mock_db.commit = AsyncMock()

        mock_user = make_mock_user()
        app = make_test_app(mock_db, mock_user)

        with TestClient(app) as client:
            response = client.delete("/api/v1/retirement/wrap-accounts/1")

        assert response.status_code == 204
        # Verify soft delete: is_active set to False
        assert mock_account.is_active is False
        mock_db.commit.assert_awaited_once()

    def test_delete_returns_404_when_not_found(self):
        """Should return 404 when account does not exist."""
        mock_db = AsyncMock(spec=AsyncSession)
        mock_db.get = AsyncMock(return_value=None)

        mock_user = make_mock_user()
        app = make_test_app(mock_db, mock_user)

        with TestClient(app) as client:
            response = client.delete("/api/v1/retirement/wrap-accounts/999")

        assert response.status_code == 404
