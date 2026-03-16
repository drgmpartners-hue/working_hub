"""Tests for client portal API endpoints."""
import pytest
from datetime import date, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi.testclient import TestClient
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.client_portal import router
from app.api.v1.portfolio_suggestions import router as suggestions_router
from app.models.client import Client, ClientAccount
from app.models.portfolio_suggestion import PortfolioSuggestion
from app.models.call_reservation import CallReservation
from app.models.user import User
from app.core.deps import get_current_user
from app.db.session import get_db
from app.services import client_portal_service


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_test_app(mock_db: AsyncSession, mock_user: User = None) -> FastAPI:
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.include_router(suggestions_router, prefix="/api/v1")
    app.dependency_overrides[get_db] = lambda: mock_db
    if mock_user:
        app.dependency_overrides[get_current_user] = lambda: mock_user
    return app


def make_mock_user() -> User:
    user = MagicMock(spec=User)
    user.id = "test-user-id"
    user.is_active = True
    return user


def make_mock_client(**kwargs) -> Client:
    c = MagicMock(spec=Client)
    c.id = kwargs.get("id", "client-uuid-001")
    c.user_id = kwargs.get("user_id", "test-user-id")
    c.name = kwargs.get("name", "홍길동")
    c.birth_date = kwargs.get("birth_date", date(1990, 1, 1))
    c.phone = kwargs.get("phone", "010-1234-5678")
    c.email = kwargs.get("email", "test@example.com")
    c.portal_token = kwargs.get("portal_token", "test-portal-token-001")
    c.memo = kwargs.get("memo", None)
    c.created_at = kwargs.get("created_at", datetime(2026, 1, 1))
    c.accounts = kwargs.get("accounts", [])
    return c


def make_mock_suggestion(**kwargs) -> PortfolioSuggestion:
    s = MagicMock(spec=PortfolioSuggestion)
    s.id = kwargs.get("id", "suggest-uuid-001")
    s.account_id = kwargs.get("account_id", "account-uuid-001")
    s.snapshot_id = kwargs.get("snapshot_id", "snapshot-uuid-001")
    s.suggested_weights = kwargs.get("suggested_weights", {"holding-1": 0.5, "holding-2": 0.5})
    s.ai_comment = kwargs.get("ai_comment", "AI 코멘트")
    s.expires_at = kwargs.get("expires_at", datetime.utcnow() + timedelta(days=7))
    s.created_at = kwargs.get("created_at", datetime(2026, 1, 1))
    return s


def make_mock_reservation(**kwargs) -> CallReservation:
    r = MagicMock(spec=CallReservation)
    r.id = kwargs.get("id", "reservation-uuid-001")
    r.suggestion_id = kwargs.get("suggestion_id", "suggest-uuid-001")
    r.client_name = kwargs.get("client_name", "홍길동")
    r.phone = kwargs.get("phone", "010-1234-5678")
    r.preferred_date = kwargs.get("preferred_date", date(2026, 3, 20))
    r.preferred_time = kwargs.get("preferred_time", "10:00")
    r.status = kwargs.get("status", "pending")
    r.created_at = kwargs.get("created_at", datetime(2026, 1, 1))
    return r


# ---------------------------------------------------------------------------
# Test: GET /api/v1/client-portal/{token}
# ---------------------------------------------------------------------------

class TestCheckPortalToken:
    """Tests for GET /api/v1/client-portal/{token}."""

    def test_existing_token_returns_masked_name(self):
        """Should return exists=True and masked name for valid token."""
        mock_db = MagicMock(spec=AsyncSession)
        client = make_mock_client(name="홍길동", portal_token="valid-token-001")

        with patch.object(
            client_portal_service,
            "check_portal_token",
            new=AsyncMock(return_value={"exists": True, "masked_name": "홍*동"}),
        ):
            app = make_test_app(mock_db)
            with TestClient(app) as tc:
                resp = tc.get("/api/v1/client-portal/valid-token-001")
            assert resp.status_code == 200
            data = resp.json()
            assert data["exists"] is True
            assert data["masked_name"] == "홍*동"

    def test_nonexistent_token_returns_not_found(self):
        """Should return exists=False for unknown token."""
        mock_db = MagicMock(spec=AsyncSession)

        with patch.object(
            client_portal_service,
            "check_portal_token",
            new=AsyncMock(return_value={"exists": False, "masked_name": None}),
        ):
            app = make_test_app(mock_db)
            with TestClient(app) as tc:
                resp = tc.get("/api/v1/client-portal/nonexistent-token")
            assert resp.status_code == 200
            data = resp.json()
            assert data["exists"] is False
            assert data["masked_name"] is None

    def test_two_char_name_masked_correctly(self):
        """2-char name should be masked as 'X*'."""
        assert client_portal_service.mask_name("홍길") == "홍*"

    def test_three_char_name_masked_correctly(self):
        """3-char name should be masked as 'X*X'."""
        assert client_portal_service.mask_name("홍길동") == "홍*동"

    def test_one_char_name_masked_correctly(self):
        """1-char name should be masked as '*'."""
        assert client_portal_service.mask_name("홍") == "*"

    def test_four_char_name_masked_correctly(self):
        """4-char name should mask middle chars."""
        assert client_portal_service.mask_name("홍길동민") == "홍**민"


# ---------------------------------------------------------------------------
# Test: POST /api/v1/client-portal/{token}/verify
# ---------------------------------------------------------------------------

class TestVerifyClient:
    """Tests for POST /api/v1/client-portal/{token}/verify."""

    def test_successful_verification_returns_jwt(self):
        """Valid credentials should return access_token."""
        mock_db = MagicMock(spec=AsyncSession)
        fake_token = "fake.jwt.token"

        with patch.object(
            client_portal_service,
            "verify_client",
            new=AsyncMock(return_value=(fake_token, "")),
        ):
            app = make_test_app(mock_db)
            with TestClient(app) as tc:
                resp = tc.post(
                    "/api/v1/client-portal/valid-token-001/verify",
                    json={"birth_date": "1990-01-01", "phone": "010-1234-5678"},
                )
            assert resp.status_code == 200
            data = resp.json()
            assert data["access_token"] == fake_token
            assert data["token_type"] == "bearer"

    def test_invalid_credentials_returns_401(self):
        """Wrong birth_date or phone should return 401."""
        mock_db = MagicMock(spec=AsyncSession)

        with patch.object(
            client_portal_service,
            "verify_client",
            new=AsyncMock(return_value=(None, "invalid")),
        ):
            app = make_test_app(mock_db)
            with TestClient(app) as tc:
                resp = tc.post(
                    "/api/v1/client-portal/valid-token-001/verify",
                    json={"birth_date": "1991-01-01", "phone": "010-0000-0000"},
                )
            assert resp.status_code == 401

    def test_locked_account_returns_429(self):
        """After 3 failures, should return 429."""
        mock_db = MagicMock(spec=AsyncSession)

        with patch.object(
            client_portal_service,
            "verify_client",
            new=AsyncMock(return_value=(None, "locked")),
        ):
            app = make_test_app(mock_db)
            with TestClient(app) as tc:
                resp = tc.post(
                    "/api/v1/client-portal/valid-token-001/verify",
                    json={"birth_date": "1990-01-01", "phone": "010-1234-5678"},
                )
            assert resp.status_code == 429

    def test_unknown_token_returns_404(self):
        """Unknown portal token should return 404."""
        mock_db = MagicMock(spec=AsyncSession)

        with patch.object(
            client_portal_service,
            "verify_client",
            new=AsyncMock(return_value=(None, "not_found")),
        ):
            app = make_test_app(mock_db)
            with TestClient(app) as tc:
                resp = tc.post(
                    "/api/v1/client-portal/unknown-token/verify",
                    json={"birth_date": "1990-01-01", "phone": "010-1234-5678"},
                )
            assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Test: lockout logic (unit-level)
# ---------------------------------------------------------------------------

class TestLockoutLogic:
    """Unit tests for in-memory brute-force lockout."""

    def setup_method(self):
        """Reset lockout store before each test."""
        client_portal_service._lockout_store.clear()

    def test_no_lockout_after_two_failures(self):
        """Should not be locked after 2 failures."""
        token = "test-lockout-token"
        client_portal_service._record_failure(token)
        client_portal_service._record_failure(token)
        assert not client_portal_service._is_locked(token)

    def test_locked_after_three_failures(self):
        """Should be locked after 3 failures."""
        token = "test-lockout-token"
        for _ in range(3):
            client_portal_service._record_failure(token)
        assert client_portal_service._is_locked(token)

    def test_reset_clears_failures(self):
        """_reset_failures should clear lock state."""
        token = "test-lockout-token"
        for _ in range(3):
            client_portal_service._record_failure(token)
        client_portal_service._reset_failures(token)
        assert not client_portal_service._is_locked(token)


# ---------------------------------------------------------------------------
# Test: GET /api/v1/client-portal/{token}/snapshots
# ---------------------------------------------------------------------------

class TestGetSnapshots:
    """Tests for GET /api/v1/client-portal/{token}/snapshots."""

    def _make_portal_jwt(self, client_id: str = "client-uuid-001") -> str:
        return client_portal_service.create_portal_jwt(client_id, "test-token")

    def test_requires_portal_jwt(self):
        """Should return 401 without Authorization header."""
        mock_db = MagicMock(spec=AsyncSession)
        app = make_test_app(mock_db)
        with TestClient(app) as tc:
            resp = tc.get("/api/v1/client-portal/test-token/snapshots")
        assert resp.status_code == 401

    def test_returns_account_snapshots(self):
        """Valid portal JWT should return snapshot dates."""
        mock_db = MagicMock(spec=AsyncSession)
        jwt_token = self._make_portal_jwt()

        with patch.object(
            client_portal_service,
            "get_client_snapshots",
            new=AsyncMock(
                return_value=[
                    {
                        "account_id": "account-001",
                        "account_type": "irp",
                        "dates": ["2026-01-15", "2026-02-15"],
                    }
                ]
            ),
        ):
            app = make_test_app(mock_db)
            with TestClient(app) as tc:
                resp = tc.get(
                    "/api/v1/client-portal/test-token/snapshots",
                    headers={"Authorization": f"Bearer {jwt_token}"},
                )
            assert resp.status_code == 200
            data = resp.json()
            assert len(data["accounts"]) == 1
            assert data["accounts"][0]["account_type"] == "irp"
            assert "2026-01-15" in data["accounts"][0]["dates"]


# ---------------------------------------------------------------------------
# Test: GET /api/v1/client-portal/{token}/suggestion/{suggest_id}
# ---------------------------------------------------------------------------

class TestGetSuggestion:
    """Tests for suggestion endpoint."""

    def _make_portal_jwt(self, client_id: str = "client-uuid-001") -> str:
        return client_portal_service.create_portal_jwt(client_id, "test-token")

    def test_returns_active_suggestion(self):
        """Should return suggestion with expired=False for future expires_at."""
        mock_db = MagicMock(spec=AsyncSession)
        jwt_token = self._make_portal_jwt()
        suggestion = make_mock_suggestion(expires_at=datetime.utcnow() + timedelta(days=5))

        with patch.object(
            client_portal_service,
            "get_suggestion",
            new=AsyncMock(return_value=suggestion),
        ):
            app = make_test_app(mock_db)
            with TestClient(app) as tc:
                resp = tc.get(
                    "/api/v1/client-portal/test-token/suggestion/suggest-uuid-001",
                    headers={"Authorization": f"Bearer {jwt_token}"},
                )
            assert resp.status_code == 200
            data = resp.json()
            assert data["expired"] is False
            assert data["id"] == "suggest-uuid-001"

    def test_returns_expired_flag_for_old_suggestion(self):
        """Should return expired=True for past expires_at."""
        mock_db = MagicMock(spec=AsyncSession)
        jwt_token = self._make_portal_jwt()
        suggestion = make_mock_suggestion(expires_at=datetime.utcnow() - timedelta(days=1))

        with patch.object(
            client_portal_service,
            "get_suggestion",
            new=AsyncMock(return_value=suggestion),
        ):
            app = make_test_app(mock_db)
            with TestClient(app) as tc:
                resp = tc.get(
                    "/api/v1/client-portal/test-token/suggestion/suggest-uuid-001",
                    headers={"Authorization": f"Bearer {jwt_token}"},
                )
            assert resp.status_code == 200
            data = resp.json()
            assert data["expired"] is True

    def test_returns_404_for_missing_suggestion(self):
        """Should return 404 when suggestion not found."""
        mock_db = MagicMock(spec=AsyncSession)
        jwt_token = self._make_portal_jwt()

        with patch.object(
            client_portal_service,
            "get_suggestion",
            new=AsyncMock(return_value=None),
        ):
            app = make_test_app(mock_db)
            with TestClient(app) as tc:
                resp = tc.get(
                    "/api/v1/client-portal/test-token/suggestion/nonexistent",
                    headers={"Authorization": f"Bearer {jwt_token}"},
                )
            assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Test: POST /api/v1/client-portal/suggestion/{suggest_id}/call-reserve
# ---------------------------------------------------------------------------

class TestCallReservation:
    """Tests for call reservation endpoint."""

    def test_creates_reservation_successfully(self):
        """Should create and return a reservation."""
        mock_db = MagicMock(spec=AsyncSession)
        suggestion = make_mock_suggestion()
        reservation = make_mock_reservation()

        with patch.object(
            client_portal_service,
            "get_suggestion",
            new=AsyncMock(return_value=suggestion),
        ), patch.object(
            client_portal_service,
            "create_call_reservation",
            new=AsyncMock(return_value=reservation),
        ):
            app = make_test_app(mock_db)
            with TestClient(app) as tc:
                resp = tc.post(
                    "/api/v1/client-portal/suggestion/suggest-uuid-001/call-reserve",
                    json={
                        "preferred_date": "2026-03-20",
                        "preferred_time": "10:00",
                        "client_name": "홍길동",
                        "phone": "010-1234-5678",
                    },
                )
            assert resp.status_code == 200
            data = resp.json()
            assert data["status"] == "pending"

    def test_returns_404_for_invalid_suggestion(self):
        """Should return 404 when suggestion doesn't exist."""
        mock_db = MagicMock(spec=AsyncSession)

        with patch.object(
            client_portal_service,
            "get_suggestion",
            new=AsyncMock(return_value=None),
        ):
            app = make_test_app(mock_db)
            with TestClient(app) as tc:
                resp = tc.post(
                    "/api/v1/client-portal/suggestion/nonexistent/call-reserve",
                    json={"preferred_date": "2026-03-20", "preferred_time": "10:00"},
                )
            assert resp.status_code == 404
