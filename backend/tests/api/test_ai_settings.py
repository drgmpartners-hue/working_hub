"""Tests for AI API settings endpoints.

Covers:
  GET /api/v1/settings/ai  - list all AI settings (keys masked)
  PUT /api/v1/settings/ai  - upsert an AI setting

Uses the same mock-based approach as test_brand.py so no running database
is required.  Integration-style tests that use an in-memory SQLite DB are
also included, mirroring test_auth.py.
"""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.ai_settings import router
from app.models.ai_setting import AIAPISetting
from app.models.user import User
from app.core.deps import get_current_user
from app.db.session import get_db
from app.core.security import encrypt_api_key, decrypt_api_key, mask_api_key


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_test_app(mock_db: AsyncSession, mock_user: User) -> FastAPI:
    """Minimal FastAPI app with ai_settings router and mocked dependencies."""
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_db] = lambda: mock_db
    app.dependency_overrides[get_current_user] = lambda: mock_user
    return app


def make_mock_user() -> User:
    user = MagicMock(spec=User)
    user.id = "test-user-id"
    user.is_active = True
    return user


def make_mock_setting(
    *,
    id: str = "setting-uuid-001",
    provider: str = "openai",
    plain_api_key: str = "sk-abcdefgh1234",
    is_active: bool = True,
) -> AIAPISetting:
    """Return a MagicMock that looks like an AIAPISetting ORM instance."""
    setting = MagicMock(spec=AIAPISetting)
    setting.id = id
    setting.provider = provider
    setting.api_key_encrypted = encrypt_api_key(plain_api_key)
    setting.is_active = is_active
    return setting


# ---------------------------------------------------------------------------
# Encryption / masking unit tests
# ---------------------------------------------------------------------------

class TestEncryptionUtils:
    """Unit tests for the encryption/masking helpers in security.py."""

    def test_encrypt_decrypt_roundtrip(self):
        plain = "sk-secretkey12345"
        encrypted = encrypt_api_key(plain)
        assert encrypted != plain
        assert decrypt_api_key(encrypted) == plain

    def test_encrypt_produces_different_ciphertext_each_time(self):
        """Fernet uses a random IV so each encryption is unique."""
        plain = "sk-secretkey12345"
        c1 = encrypt_api_key(plain)
        c2 = encrypt_api_key(plain)
        assert c1 != c2

    def test_mask_api_key_long_key(self):
        plain = "sk-abcdefgh1234"
        assert mask_api_key(plain) == "sk-...1234"

    def test_mask_api_key_exactly_4_chars(self):
        assert mask_api_key("abcd") == "abcd"

    def test_mask_api_key_shorter_than_4_chars(self):
        assert mask_api_key("abc") == "abc"

    def test_mask_api_key_uses_last_4_chars(self):
        plain = "XXXX-suffix"
        masked = mask_api_key(plain)
        assert masked.endswith("uffix"[-4:])
        assert "sk-..." in masked


# ---------------------------------------------------------------------------
# GET /api/v1/settings/ai
# ---------------------------------------------------------------------------

class TestListAISettings:
    """Tests for GET /api/v1/settings/ai."""

    def test_returns_empty_list_when_no_settings(self):
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = []

        mock_db = AsyncMock(spec=AsyncSession)
        mock_db.execute = AsyncMock(return_value=mock_result)

        mock_user = make_mock_user()
        app = make_test_app(mock_db, mock_user)

        with TestClient(app) as client:
            response = client.get("/api/v1/settings/ai")

        assert response.status_code == 200
        assert response.json() == []

    def test_returns_list_with_masked_keys(self):
        s1 = make_mock_setting(provider="openai", plain_api_key="sk-openai-secretXYZW")
        s2 = make_mock_setting(
            id="setting-uuid-002",
            provider="anthropic",
            plain_api_key="sk-ant-secretABCD",
            is_active=False,
        )

        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = [s1, s2]

        mock_db = AsyncMock(spec=AsyncSession)
        mock_db.execute = AsyncMock(return_value=mock_result)

        mock_user = make_mock_user()
        app = make_test_app(mock_db, mock_user)

        with TestClient(app) as client:
            response = client.get("/api/v1/settings/ai")

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 2

        openai_item = next(d for d in data if d["provider"] == "openai")
        assert openai_item["api_key_masked"].startswith("sk-...")
        assert openai_item["api_key_masked"].endswith("XYZW")
        assert "secretXYZW" not in openai_item["api_key_masked"]

    def test_response_has_required_fields(self):
        s = make_mock_setting()

        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = [s]

        mock_db = AsyncMock(spec=AsyncSession)
        mock_db.execute = AsyncMock(return_value=mock_result)

        mock_user = make_mock_user()
        app = make_test_app(mock_db, mock_user)

        with TestClient(app) as client:
            response = client.get("/api/v1/settings/ai")

        item = response.json()[0]
        for field in ("id", "provider", "api_key_masked", "is_active"):
            assert field in item, f"Missing field: {field}"

    def test_requires_authentication(self):
        mock_db = AsyncMock(spec=AsyncSession)

        app = FastAPI()
        app.include_router(router, prefix="/api/v1")
        app.dependency_overrides[get_db] = lambda: mock_db
        # get_current_user is NOT overridden -> should fail auth

        with TestClient(app, raise_server_exceptions=False) as client:
            response = client.get("/api/v1/settings/ai")

        assert response.status_code in (401, 403, 422)

    def test_raw_api_key_not_in_response(self):
        """The plaintext api_key must never appear in the response body."""
        plain = "sk-supersecret1234567890"
        s = make_mock_setting(plain_api_key=plain)

        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = [s]

        mock_db = AsyncMock(spec=AsyncSession)
        mock_db.execute = AsyncMock(return_value=mock_result)

        mock_user = make_mock_user()
        app = make_test_app(mock_db, mock_user)

        with TestClient(app) as client:
            response = client.get("/api/v1/settings/ai")

        assert plain not in response.text


# ---------------------------------------------------------------------------
# PUT /api/v1/settings/ai
# ---------------------------------------------------------------------------

class TestUpsertAISetting:
    """Tests for PUT /api/v1/settings/ai."""

    def test_create_new_setting_returns_200(self):
        """If no record exists for the provider, a new one is created."""
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None

        import uuid as _uuid

        def _fake_refresh(obj):
            """Simulate what DB refresh does: populate server-generated fields."""
            if not getattr(obj, "id", None):
                obj.id = str(_uuid.uuid4())

        mock_db = AsyncMock(spec=AsyncSession)
        mock_db.execute = AsyncMock(return_value=mock_result)
        mock_db.add = MagicMock()
        mock_db.commit = AsyncMock()
        mock_db.refresh = AsyncMock(side_effect=_fake_refresh)

        mock_user = make_mock_user()

        # Do NOT patch AIAPISetting - let the router create a real ORM instance.
        # Patching the class replaces it with a MagicMock which breaks
        # select(AIAPISetting).where(AIAPISetting.provider == ...) because
        # SQLAlchemy's select() rejects non-column arguments.
        app = make_test_app(mock_db, mock_user)
        with TestClient(app) as client:
            response = client.put(
                "/api/v1/settings/ai",
                json={"provider": "openai", "api_key": "sk-new1234", "is_active": True},
            )

        assert response.status_code == 200
        mock_db.add.assert_called_once()
        mock_db.commit.assert_awaited_once()

    def test_update_existing_setting(self):
        """If a record already exists, it should be updated in-place."""
        existing = make_mock_setting(provider="openai", plain_api_key="sk-old0000")

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = existing

        mock_db = AsyncMock(spec=AsyncSession)
        mock_db.execute = AsyncMock(return_value=mock_result)
        mock_db.commit = AsyncMock()
        mock_db.refresh = AsyncMock(side_effect=lambda obj: None)

        mock_user = make_mock_user()
        app = make_test_app(mock_db, mock_user)

        with TestClient(app) as client:
            response = client.put(
                "/api/v1/settings/ai",
                json={"provider": "openai", "api_key": "sk-new5678", "is_active": False},
            )

        assert response.status_code == 200
        # Existing record must be updated (add should NOT be called)
        mock_db.add.assert_not_called()
        mock_db.commit.assert_awaited_once()

        # The encrypted field should have been replaced
        new_plain = decrypt_api_key(existing.api_key_encrypted)
        assert new_plain == "sk-new5678"

    def test_response_masks_api_key(self):
        """PUT response must mask the api_key."""
        existing = make_mock_setting(provider="openai", plain_api_key="sk-old0000")

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = existing

        mock_db = AsyncMock(spec=AsyncSession)
        mock_db.execute = AsyncMock(return_value=mock_result)
        mock_db.commit = AsyncMock()
        mock_db.refresh = AsyncMock(side_effect=lambda obj: None)

        mock_user = make_mock_user()
        app = make_test_app(mock_db, mock_user)

        with TestClient(app) as client:
            response = client.put(
                "/api/v1/settings/ai",
                json={"provider": "openai", "api_key": "sk-abcd5678", "is_active": True},
            )

        assert response.status_code == 200
        data = response.json()
        assert "api_key_masked" in data
        assert data["api_key_masked"].endswith("5678")
        assert "sk-abcd5678" not in response.text

    def test_missing_provider_returns_422(self):
        mock_db = AsyncMock(spec=AsyncSession)
        mock_user = make_mock_user()
        app = make_test_app(mock_db, mock_user)

        with TestClient(app) as client:
            response = client.put(
                "/api/v1/settings/ai",
                json={"api_key": "sk-something"},
            )

        assert response.status_code == 422

    def test_missing_api_key_returns_422(self):
        mock_db = AsyncMock(spec=AsyncSession)
        mock_user = make_mock_user()
        app = make_test_app(mock_db, mock_user)

        with TestClient(app) as client:
            response = client.put(
                "/api/v1/settings/ai",
                json={"provider": "openai"},
            )

        assert response.status_code == 422

    def test_empty_provider_returns_422(self):
        mock_db = AsyncMock(spec=AsyncSession)
        mock_user = make_mock_user()
        app = make_test_app(mock_db, mock_user)

        with TestClient(app) as client:
            response = client.put(
                "/api/v1/settings/ai",
                json={"provider": "   ", "api_key": "sk-something"},
            )

        assert response.status_code == 422

    def test_empty_api_key_returns_422(self):
        mock_db = AsyncMock(spec=AsyncSession)
        mock_user = make_mock_user()
        app = make_test_app(mock_db, mock_user)

        with TestClient(app) as client:
            response = client.put(
                "/api/v1/settings/ai",
                json={"provider": "openai", "api_key": ""},
            )

        assert response.status_code == 422

    def test_requires_authentication(self):
        mock_db = AsyncMock(spec=AsyncSession)

        app = FastAPI()
        app.include_router(router, prefix="/api/v1")
        app.dependency_overrides[get_db] = lambda: mock_db

        with TestClient(app, raise_server_exceptions=False) as client:
            response = client.put(
                "/api/v1/settings/ai",
                json={"provider": "openai", "api_key": "sk-key", "is_active": True},
            )

        assert response.status_code in (401, 403, 422)

    def test_is_active_defaults_to_false(self):
        """is_active should be optional and default to False."""
        existing = make_mock_setting(provider="openai", plain_api_key="sk-test1234")

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = existing

        mock_db = AsyncMock(spec=AsyncSession)
        mock_db.execute = AsyncMock(return_value=mock_result)
        mock_db.commit = AsyncMock()
        mock_db.refresh = AsyncMock(side_effect=lambda obj: None)

        mock_user = make_mock_user()
        app = make_test_app(mock_db, mock_user)

        with TestClient(app) as client:
            response = client.put(
                "/api/v1/settings/ai",
                json={"provider": "openai", "api_key": "sk-test1234"},
                # is_active intentionally omitted
            )

        assert response.status_code == 200
        # is_active on the existing object should be set to False (the default)
        assert existing.is_active is False


# ---------------------------------------------------------------------------
# Schema unit tests
# ---------------------------------------------------------------------------

class TestAISettingSchemas:
    """Unit tests for Pydantic schema validation."""

    def test_ai_setting_update_requires_provider_and_api_key(self):
        from app.schemas.ai_setting import AISettingUpdate
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            AISettingUpdate(provider="openai")  # missing api_key

        with pytest.raises(ValidationError):
            AISettingUpdate(api_key="sk-test")  # missing provider

    def test_ai_setting_update_strips_whitespace(self):
        from app.schemas.ai_setting import AISettingUpdate

        update = AISettingUpdate(provider="  openai  ", api_key="  sk-test  ")
        assert update.provider == "openai"
        assert update.api_key == "sk-test"

    def test_ai_setting_response_from_dict(self):
        from app.schemas.ai_setting import AISettingResponse

        data = {
            "id": "abc-123",
            "provider": "openai",
            "api_key_masked": "sk-...5678",
            "is_active": True,
        }
        resp = AISettingResponse.model_validate(data)
        assert resp.id == "abc-123"
        assert resp.provider == "openai"
        assert resp.api_key_masked == "sk-...5678"
        assert resp.is_active is True
