"""Tests for auth API endpoints.

Covers:
  POST /api/v1/auth/register
  POST /api/v1/auth/login          (form-data / OAuth2PasswordRequestForm)
  POST /api/v1/auth/login/json     (JSON body)
  POST /api/v1/auth/logout
  GET  /api/v1/users/me

Strategy
--------
- No real database is required.  The ``get_db`` FastAPI dependency is overridden
  to yield a ``MagicMock`` session, and the service-layer functions
  (``get_user_by_email``, ``authenticate_user``, ``create_user``) are patched
  with ``AsyncMock`` so tests are fully isolated from PostgreSQL.
- ``httpx.AsyncClient`` with ``ASGITransport`` drives the ASGI app in-process.
- ``asyncio_mode = "auto"`` in pyproject.toml means every async test/fixture
  runs automatically without explicit ``@pytest.mark.asyncio`` decorators.
"""
from __future__ import annotations

from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

# ---------------------------------------------------------------------------
# Shared test data
# ---------------------------------------------------------------------------

_USER_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
_EMAIL = "test@example.com"
_NICKNAME = "tester"
_HASHED_PW = "$2b$12$fakehashfakehashfakehashfakehashfakehash"


def _make_user(email: str = _EMAIL, nickname: str = _NICKNAME, is_active: bool = True):
    """Return a mock User ORM object."""
    user = MagicMock()
    user.id = _USER_ID
    user.email = email
    user.nickname = nickname
    user.hashed_password = _HASHED_PW
    user.profile_image = None
    user.is_active = is_active
    user.created_at = datetime(2024, 1, 1, 0, 0, 0)
    user.updated_at = datetime(2024, 1, 1, 0, 0, 0)
    return user


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture
async def client():
    """AsyncClient wired to the FastAPI app with ``get_db`` overridden."""
    from app.db.session import get_db
    from app.main import app

    async def _fake_db():
        yield MagicMock()

    app.dependency_overrides[get_db] = _fake_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# POST /api/v1/auth/register
# ---------------------------------------------------------------------------

class TestRegister:
    """POST /api/v1/auth/register"""

    async def test_register_new_user_returns_201(self, client: AsyncClient):
        mock_user = _make_user()
        with (
            patch("app.api.v1.auth.get_user_by_email", new=AsyncMock(return_value=None)),
            patch("app.api.v1.auth.create_user", new=AsyncMock(return_value=mock_user)),
        ):
            resp = await client.post(
                "/api/v1/auth/register",
                json={"email": _EMAIL, "password": "Password1!", "nickname": _NICKNAME},
            )
        assert resp.status_code == 201
        body = resp.json()
        assert body["email"] == _EMAIL
        assert body["nickname"] == _NICKNAME
        assert "hashed_password" not in body

    async def test_register_duplicate_email_returns_400(self, client: AsyncClient):
        existing = _make_user()
        with patch("app.api.v1.auth.get_user_by_email", new=AsyncMock(return_value=existing)):
            resp = await client.post(
                "/api/v1/auth/register",
                json={"email": _EMAIL, "password": "Password1!", "nickname": _NICKNAME},
            )
        assert resp.status_code == 400
        assert "already registered" in resp.json()["detail"].lower()

    async def test_register_missing_nickname_returns_422(self, client: AsyncClient):
        resp = await client.post(
            "/api/v1/auth/register",
            json={"email": _EMAIL, "password": "Password1!"},
        )
        assert resp.status_code == 422

    async def test_register_invalid_email_format_returns_422(self, client: AsyncClient):
        resp = await client.post(
            "/api/v1/auth/register",
            json={"email": "not-an-email", "password": "Password1!", "nickname": _NICKNAME},
        )
        assert resp.status_code == 422

    async def test_register_missing_password_returns_422(self, client: AsyncClient):
        resp = await client.post(
            "/api/v1/auth/register",
            json={"email": _EMAIL, "nickname": _NICKNAME},
        )
        assert resp.status_code == 422


# ---------------------------------------------------------------------------
# POST /api/v1/auth/login  (OAuth2 form-data)
# ---------------------------------------------------------------------------

class TestLoginForm:
    """POST /api/v1/auth/login (application/x-www-form-urlencoded)"""

    async def test_valid_credentials_return_bearer_token(self, client: AsyncClient):
        mock_user = _make_user()
        with patch("app.api.v1.auth.authenticate_user", new=AsyncMock(return_value=mock_user)):
            resp = await client.post(
                "/api/v1/auth/login",
                data={"username": _EMAIL, "password": "Password1!"},
            )
        assert resp.status_code == 200
        body = resp.json()
        assert "access_token" in body
        assert body["token_type"] == "bearer"
        assert len(body["access_token"]) > 20

    async def test_wrong_password_returns_401(self, client: AsyncClient):
        with patch("app.api.v1.auth.authenticate_user", new=AsyncMock(return_value=None)):
            resp = await client.post(
                "/api/v1/auth/login",
                data={"username": _EMAIL, "password": "wrong"},
            )
        assert resp.status_code == 401

    async def test_unknown_user_returns_401(self, client: AsyncClient):
        with patch("app.api.v1.auth.authenticate_user", new=AsyncMock(return_value=None)):
            resp = await client.post(
                "/api/v1/auth/login",
                data={"username": "ghost@example.com", "password": "whatever"},
            )
        assert resp.status_code == 401

    async def test_missing_username_returns_422(self, client: AsyncClient):
        resp = await client.post(
            "/api/v1/auth/login",
            data={"password": "Password1!"},
        )
        assert resp.status_code == 422


# ---------------------------------------------------------------------------
# POST /api/v1/auth/login/json
# ---------------------------------------------------------------------------

class TestLoginJson:
    """POST /api/v1/auth/login/json (application/json)"""

    async def test_valid_json_credentials_return_bearer_token(self, client: AsyncClient):
        mock_user = _make_user()
        with patch("app.api.v1.auth.authenticate_user", new=AsyncMock(return_value=mock_user)):
            resp = await client.post(
                "/api/v1/auth/login/json",
                json={"email": _EMAIL, "password": "Password1!"},
            )
        assert resp.status_code == 200
        body = resp.json()
        assert "access_token" in body
        assert body["token_type"] == "bearer"

    async def test_wrong_password_returns_401(self, client: AsyncClient):
        with patch("app.api.v1.auth.authenticate_user", new=AsyncMock(return_value=None)):
            resp = await client.post(
                "/api/v1/auth/login/json",
                json={"email": _EMAIL, "password": "wrong"},
            )
        assert resp.status_code == 401

    async def test_invalid_email_format_returns_422(self, client: AsyncClient):
        resp = await client.post(
            "/api/v1/auth/login/json",
            json={"email": "not-valid", "password": "Password1!"},
        )
        assert resp.status_code == 422

    async def test_missing_password_returns_422(self, client: AsyncClient):
        resp = await client.post(
            "/api/v1/auth/login/json",
            json={"email": _EMAIL},
        )
        assert resp.status_code == 422


# ---------------------------------------------------------------------------
# POST /api/v1/auth/logout
# ---------------------------------------------------------------------------

class TestLogout:
    """POST /api/v1/auth/logout"""

    def _auth_headers(self, token: str) -> dict:
        return {"Authorization": f"Bearer {token}"}

    async def _get_token(self, client: AsyncClient) -> str:
        mock_user = _make_user()
        with patch("app.api.v1.auth.authenticate_user", new=AsyncMock(return_value=mock_user)):
            resp = await client.post(
                "/api/v1/auth/login/json",
                json={"email": _EMAIL, "password": "Password1!"},
            )
        return resp.json()["access_token"]

    async def test_logout_with_valid_token_returns_200(self, client: AsyncClient):
        from app.core.deps import get_current_user
        from app.main import app

        mock_user = _make_user()
        app.dependency_overrides[get_current_user] = lambda: mock_user

        token = await self._get_token(client)
        resp = await client.post("/api/v1/auth/logout", headers=self._auth_headers(token))

        app.dependency_overrides.pop(get_current_user, None)

        assert resp.status_code == 200
        assert "logged out" in resp.json()["message"].lower()

    async def test_logout_without_token_returns_401(self, client: AsyncClient):
        resp = await client.post("/api/v1/auth/logout")
        assert resp.status_code == 401

    async def test_logout_with_malformed_token_returns_401(self, client: AsyncClient):
        resp = await client.post(
            "/api/v1/auth/logout",
            headers={"Authorization": "Bearer this.is.not.valid"},
        )
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# GET /api/v1/users/me
# ---------------------------------------------------------------------------

class TestGetMe:
    """GET /api/v1/users/me"""

    async def test_me_with_valid_token_returns_profile(self, client: AsyncClient):
        from app.core.deps import get_current_user
        from app.main import app

        mock_user = _make_user()
        app.dependency_overrides[get_current_user] = lambda: mock_user

        resp = await client.get("/api/v1/users/me")

        app.dependency_overrides.pop(get_current_user, None)

        assert resp.status_code == 200
        body = resp.json()
        assert body["email"] == _EMAIL
        assert body["nickname"] == _NICKNAME
        assert body["id"] == _USER_ID
        assert "hashed_password" not in body

    async def test_me_without_token_returns_401(self, client: AsyncClient):
        resp = await client.get("/api/v1/users/me")
        assert resp.status_code == 401

    async def test_me_with_malformed_token_returns_401(self, client: AsyncClient):
        resp = await client.get(
            "/api/v1/users/me",
            headers={"Authorization": "Bearer invalid.token.data"},
        )
        assert resp.status_code == 401
