"""Tests for call reservations API (PF-R4-T2)."""
from datetime import date, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.call_reservations import router
from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.call_reservation import CallReservation
from app.models.user import User


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_test_app(mock_db: AsyncSession, mock_user: User = None) -> FastAPI:
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_db] = lambda: mock_db
    if mock_user:
        app.dependency_overrides[get_current_user] = lambda: mock_user
    return app


def make_mock_user() -> User:
    user = MagicMock(spec=User)
    user.id = "test-user-id"
    user.is_active = True
    return user


def make_mock_reservation(
    id: str = "res-1",
    status: str = "pending",
    client_name: str = "홍길동",
    phone: str = "010-1234-5678",
) -> CallReservation:
    r = MagicMock(spec=CallReservation)
    r.id = id
    r.suggestion_id = "sugg-1"
    r.client_name = client_name
    r.phone = phone
    r.preferred_date = date(2026, 4, 1)
    r.preferred_time = "10:00"
    r.status = status
    r.created_at = datetime(2026, 3, 16, 9, 0, 0)
    return r


def make_mock_db() -> AsyncSession:
    db = AsyncMock(spec=AsyncSession)
    return db


# ---------------------------------------------------------------------------
# Tests: GET /api/v1/call-reservations
# ---------------------------------------------------------------------------

class TestListCallReservations:
    def test_returns_empty_list_when_no_reservations(self):
        """GET /call-reservations returns empty list when DB has no rows."""
        mock_db = make_mock_db()
        mock_user = make_mock_user()

        # Simulate empty DB result
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = []
        mock_db.execute = AsyncMock(return_value=mock_result)

        app = make_test_app(mock_db, mock_user)
        client = TestClient(app)

        response = client.get("/api/v1/call-reservations")

        assert response.status_code == 200
        data = response.json()
        assert data["items"] == []
        assert data["total"] == 0

    def test_returns_list_of_reservations(self):
        """GET /call-reservations returns all reservations."""
        mock_db = make_mock_db()
        mock_user = make_mock_user()

        reservations = [
            make_mock_reservation("res-1", "pending"),
            make_mock_reservation("res-2", "confirmed"),
        ]

        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = reservations
        mock_db.execute = AsyncMock(return_value=mock_result)

        app = make_test_app(mock_db, mock_user)
        client = TestClient(app)

        response = client.get("/api/v1/call-reservations")

        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 2
        assert data["items"][0]["id"] == "res-1"
        assert data["items"][1]["id"] == "res-2"

    def test_filter_by_status(self):
        """GET /call-reservations?status=confirmed filters by status."""
        mock_db = make_mock_db()
        mock_user = make_mock_user()

        confirmed = [make_mock_reservation("res-2", "confirmed")]

        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = confirmed
        mock_db.execute = AsyncMock(return_value=mock_result)

        app = make_test_app(mock_db, mock_user)
        client = TestClient(app)

        response = client.get("/api/v1/call-reservations?status=confirmed")

        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 1
        assert data["items"][0]["status"] == "confirmed"

    def test_requires_authentication(self):
        """GET /call-reservations returns 401 without auth."""
        mock_db = make_mock_db()
        # No user override — dependency will reject

        from fastapi import HTTPException
        from fastapi import status as http_status

        app = FastAPI()
        app.include_router(router, prefix="/api/v1")
        app.dependency_overrides[get_db] = lambda: mock_db

        def raise_401():
            raise HTTPException(status_code=http_status.HTTP_401_UNAUTHORIZED)

        app.dependency_overrides[get_current_user] = raise_401

        client = TestClient(app, raise_server_exceptions=False)
        response = client.get("/api/v1/call-reservations")
        assert response.status_code == 401


# ---------------------------------------------------------------------------
# Tests: PUT /api/v1/call-reservations/{id}
# ---------------------------------------------------------------------------

class TestUpdateCallReservation:
    def test_update_status_to_confirmed(self):
        """PUT /call-reservations/{id} updates status to confirmed."""
        mock_db = make_mock_db()
        mock_user = make_mock_user()

        reservation = make_mock_reservation("res-1", "pending")

        # First execute: fetch reservation
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = reservation
        mock_db.execute = AsyncMock(return_value=mock_result)
        mock_db.commit = AsyncMock()
        mock_db.refresh = AsyncMock()

        # Simulate status update side-effect
        async def fake_refresh(obj):
            obj.status = "confirmed"

        mock_db.refresh.side_effect = fake_refresh

        app = make_test_app(mock_db, mock_user)
        client = TestClient(app)

        response = client.put(
            "/api/v1/call-reservations/res-1",
            json={"status": "confirmed"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["id"] == "res-1"
        assert data["status"] == "confirmed"

    def test_update_status_to_completed(self):
        """PUT /call-reservations/{id} updates status to completed."""
        mock_db = make_mock_db()
        mock_user = make_mock_user()

        reservation = make_mock_reservation("res-1", "confirmed")

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = reservation
        mock_db.execute = AsyncMock(return_value=mock_result)
        mock_db.commit = AsyncMock()
        mock_db.refresh = AsyncMock()

        async def fake_refresh(obj):
            obj.status = "completed"

        mock_db.refresh.side_effect = fake_refresh

        app = make_test_app(mock_db, mock_user)
        client = TestClient(app)

        response = client.put(
            "/api/v1/call-reservations/res-1",
            json={"status": "completed"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "completed"

    def test_returns_404_when_not_found(self):
        """PUT /call-reservations/{id} returns 404 for unknown id."""
        mock_db = make_mock_db()
        mock_user = make_mock_user()

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_db.execute = AsyncMock(return_value=mock_result)

        app = make_test_app(mock_db, mock_user)
        client = TestClient(app)

        response = client.put(
            "/api/v1/call-reservations/nonexistent",
            json={"status": "confirmed"},
        )

        assert response.status_code == 404

    def test_rejects_invalid_status(self):
        """PUT /call-reservations/{id} rejects invalid status values."""
        mock_db = make_mock_db()
        mock_user = make_mock_user()

        app = make_test_app(mock_db, mock_user)
        client = TestClient(app)

        response = client.put(
            "/api/v1/call-reservations/res-1",
            json={"status": "invalid_status"},
        )

        assert response.status_code == 422
