"""Tests for brand settings API endpoints."""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi.testclient import TestClient
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.brand import router
from app.models.brand import BrandSetting
from app.models.user import User
from app.core.deps import get_current_user
from app.db.session import get_db


# ---------------------------------------------------------------------------
# Test App Setup
# ---------------------------------------------------------------------------

def make_test_app(mock_db: AsyncSession, mock_user: User) -> FastAPI:
    """Create a minimal FastAPI app with brand router and mocked dependencies."""
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


def make_mock_brand(**kwargs) -> BrandSetting:
    brand = MagicMock(spec=BrandSetting)
    brand.id = kwargs.get("id", "brand-uuid-001")
    brand.company_name = kwargs.get("company_name", "My Company")
    brand.primary_color = kwargs.get("primary_color", "#000000")
    brand.secondary_color = kwargs.get("secondary_color", None)
    brand.logo_path = kwargs.get("logo_path", None)
    brand.font_family = kwargs.get("font_family", None)
    brand.style_config = kwargs.get("style_config", None)
    return brand


# ---------------------------------------------------------------------------
# GET /api/v1/brand
# ---------------------------------------------------------------------------

class TestGetBrandSettings:
    """Tests for GET /api/v1/brand."""

    def test_get_existing_brand_returns_200(self):
        """Should return existing brand settings."""
        mock_brand = make_mock_brand(company_name="Acme Corp", primary_color="#FF5733")

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_brand

        mock_db = AsyncMock(spec=AsyncSession)
        mock_db.execute = AsyncMock(return_value=mock_result)

        mock_user = make_mock_user()
        app = make_test_app(mock_db, mock_user)

        with TestClient(app) as client:
            response = client.get("/api/v1/brand")

        assert response.status_code == 200
        data = response.json()
        assert data["company_name"] == "Acme Corp"
        assert data["primary_color"] == "#FF5733"
        assert data["id"] == "brand-uuid-001"

    def test_get_brand_creates_default_when_none_exists(self):
        """Should create and return a default brand when none exists."""
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None

        mock_db = AsyncMock(spec=AsyncSession)
        mock_db.execute = AsyncMock(return_value=mock_result)
        mock_db.add = MagicMock()
        mock_db.commit = AsyncMock()
        mock_db.refresh = AsyncMock(side_effect=lambda obj: None)

        mock_user = make_mock_user()

        # Do NOT patch BrandSetting - let the router create a real ORM instance.
        # Patching BrandSetting replaces it with a MagicMock which breaks
        # select(BrandSetting) (SQLAlchemy rejects non-column arguments).
        app = make_test_app(mock_db, mock_user)
        with TestClient(app) as client:
            response = client.get("/api/v1/brand")

        assert response.status_code == 200
        mock_db.add.assert_called_once()
        mock_db.commit.assert_awaited_once()

    def test_get_brand_requires_authentication(self):
        """Unauthenticated request should be rejected (401/403)."""
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = make_mock_brand()

        mock_db = AsyncMock(spec=AsyncSession)
        mock_db.execute = AsyncMock(return_value=mock_result)

        # Build app WITHOUT overriding get_current_user
        app = FastAPI()
        app.include_router(router, prefix="/api/v1")
        app.dependency_overrides[get_db] = lambda: mock_db

        with TestClient(app, raise_server_exceptions=False) as client:
            response = client.get("/api/v1/brand")

        assert response.status_code in (401, 403, 422)

    def test_get_brand_response_schema_has_required_fields(self):
        """Response must include all required fields from BrandSettingResponse."""
        mock_brand = make_mock_brand(
            company_name="Test Co",
            primary_color="#AABBCC",
            secondary_color="#112233",
            logo_path="/logos/test.png",
            font_family="Roboto",
            style_config={"theme": "dark"},
        )

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_brand

        mock_db = AsyncMock(spec=AsyncSession)
        mock_db.execute = AsyncMock(return_value=mock_result)

        mock_user = make_mock_user()
        app = make_test_app(mock_db, mock_user)

        with TestClient(app) as client:
            response = client.get("/api/v1/brand")

        assert response.status_code == 200
        data = response.json()
        required_fields = ["id", "company_name", "primary_color", "secondary_color",
                           "logo_path", "font_family", "style_config"]
        for field in required_fields:
            assert field in data, f"Missing field: {field}"

        assert data["secondary_color"] == "#112233"
        assert data["logo_path"] == "/logos/test.png"
        assert data["font_family"] == "Roboto"
        assert data["style_config"] == {"theme": "dark"}


# ---------------------------------------------------------------------------
# PUT /api/v1/brand
# ---------------------------------------------------------------------------

class TestUpdateBrandSettings:
    """Tests for PUT /api/v1/brand."""

    def test_update_existing_brand_returns_200(self):
        """Should update and return brand settings."""
        existing_brand = make_mock_brand(company_name="Old Name", primary_color="#000000")

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = existing_brand

        mock_db = AsyncMock(spec=AsyncSession)
        mock_db.execute = AsyncMock(return_value=mock_result)
        mock_db.commit = AsyncMock()
        mock_db.refresh = AsyncMock(side_effect=lambda obj: None)

        mock_user = make_mock_user()
        app = make_test_app(mock_db, mock_user)

        payload = {"company_name": "New Name", "primary_color": "#FFFFFF"}

        with TestClient(app) as client:
            response = client.put("/api/v1/brand", json=payload)

        assert response.status_code == 200
        mock_db.commit.assert_awaited_once()
        mock_db.refresh.assert_awaited_once()

    def test_update_only_provided_fields(self):
        """PUT should only update fields that are explicitly provided (exclude_unset)."""
        existing_brand = make_mock_brand(
            company_name="Keep This",
            primary_color="#000000",
            font_family="Arial",
        )

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = existing_brand

        mock_db = AsyncMock(spec=AsyncSession)
        mock_db.execute = AsyncMock(return_value=mock_result)
        mock_db.commit = AsyncMock()
        mock_db.refresh = AsyncMock(side_effect=lambda obj: None)

        mock_user = make_mock_user()
        app = make_test_app(mock_db, mock_user)

        # Only update primary_color, not company_name or font_family
        payload = {"primary_color": "#FF0000"}

        with TestClient(app) as client:
            response = client.put("/api/v1/brand", json=payload)

        assert response.status_code == 200
        # Verify that primary_color was updated on the mock object.
        # setattr(brand, "primary_color", "#FF0000") sets the attribute on the MagicMock.
        assert existing_brand.primary_color == "#FF0000"
        # company_name and font_family must not have been changed from their initial values.
        assert existing_brand.company_name == "Keep This"
        assert existing_brand.font_family == "Arial"

    def test_update_creates_default_when_none_exists(self):
        """PUT should create a default record first if none exists."""
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None

        mock_db = AsyncMock(spec=AsyncSession)
        mock_db.execute = AsyncMock(return_value=mock_result)
        mock_db.add = MagicMock()
        mock_db.commit = AsyncMock()
        mock_db.refresh = AsyncMock(side_effect=lambda obj: None)

        mock_user = make_mock_user()

        # Do NOT patch BrandSetting - let the router create a real ORM instance
        # so that select(BrandSetting) in the router still receives the real class.
        app = make_test_app(mock_db, mock_user)
        with TestClient(app) as client:
            response = client.put("/api/v1/brand", json={"company_name": "Brand New"})

        assert response.status_code == 200
        mock_db.add.assert_called_once()

    def test_update_style_config_accepts_dict(self):
        """style_config field should accept arbitrary JSON dict."""
        existing_brand = make_mock_brand()

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = existing_brand

        mock_db = AsyncMock(spec=AsyncSession)
        mock_db.execute = AsyncMock(return_value=mock_result)
        mock_db.commit = AsyncMock()
        mock_db.refresh = AsyncMock(side_effect=lambda obj: None)

        mock_user = make_mock_user()
        app = make_test_app(mock_db, mock_user)

        style_config = {"theme": "dark", "fontSize": 14, "nested": {"key": "value"}}
        payload = {"style_config": style_config}

        with TestClient(app) as client:
            response = client.put("/api/v1/brand", json=payload)

        assert response.status_code == 200
        # setattr(brand, "style_config", style_config) sets the attribute on the MagicMock.
        assert existing_brand.style_config == style_config

    def test_update_requires_authentication(self):
        """Unauthenticated PUT request should be rejected."""
        mock_db = AsyncMock(spec=AsyncSession)

        app = FastAPI()
        app.include_router(router, prefix="/api/v1")
        app.dependency_overrides[get_db] = lambda: mock_db

        with TestClient(app, raise_server_exceptions=False) as client:
            response = client.put("/api/v1/brand", json={"company_name": "Test"})

        assert response.status_code in (401, 403, 422)

    def test_update_with_empty_body_is_noop(self):
        """PUT with empty body should still return 200 and not crash."""
        existing_brand = make_mock_brand()

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = existing_brand

        mock_db = AsyncMock(spec=AsyncSession)
        mock_db.execute = AsyncMock(return_value=mock_result)
        mock_db.commit = AsyncMock()
        mock_db.refresh = AsyncMock(side_effect=lambda obj: None)

        mock_user = make_mock_user()
        app = make_test_app(mock_db, mock_user)

        with TestClient(app) as client:
            response = client.put("/api/v1/brand", json={})

        assert response.status_code == 200


# ---------------------------------------------------------------------------
# Schema Tests
# ---------------------------------------------------------------------------

class TestBrandSchemas:
    """Tests for Pydantic schema validation."""

    def test_brand_setting_update_all_fields_optional(self):
        """BrandSettingUpdate should allow empty init (all fields optional)."""
        from app.schemas.brand import BrandSettingUpdate
        update = BrandSettingUpdate()
        assert update.company_name is None
        assert update.primary_color is None
        assert update.secondary_color is None
        assert update.logo_path is None
        assert update.font_family is None
        assert update.style_config is None

    def test_brand_setting_update_model_dump_exclude_unset(self):
        """model_dump(exclude_unset=True) should only include explicitly set fields."""
        from app.schemas.brand import BrandSettingUpdate
        update = BrandSettingUpdate(company_name="Acme", primary_color="#000")
        dumped = update.model_dump(exclude_unset=True)
        assert "company_name" in dumped
        assert "primary_color" in dumped
        assert "secondary_color" not in dumped
        assert "logo_path" not in dumped

    def test_brand_setting_response_from_attributes(self):
        """BrandSettingResponse should be constructable from ORM-like object."""
        from app.schemas.brand import BrandSettingResponse
        brand = make_mock_brand(
            company_name="TestCo",
            primary_color="#123456",
        )
        # Pydantic v2 model_validate from dict (simulating ORM)
        data = {
            "id": brand.id,
            "company_name": brand.company_name,
            "primary_color": brand.primary_color,
            "secondary_color": brand.secondary_color,
            "logo_path": brand.logo_path,
            "font_family": brand.font_family,
            "style_config": brand.style_config,
        }
        response = BrandSettingResponse.model_validate(data)
        assert response.id == "brand-uuid-001"
        assert response.company_name == "TestCo"
        assert response.primary_color == "#123456"

    def test_brand_setting_update_field_length_constraints(self):
        """Fields with max_length should reject overly long strings."""
        from app.schemas.brand import BrandSettingUpdate
        import pytest as _pytest
        from pydantic import ValidationError

        with _pytest.raises(ValidationError):
            BrandSettingUpdate(company_name="A" * 201)  # max 200

        with _pytest.raises(ValidationError):
            BrandSettingUpdate(primary_color="X" * 21)  # max 20
