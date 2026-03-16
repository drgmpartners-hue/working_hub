"""Tests for product master API endpoints."""
import pytest
from unittest.mock import AsyncMock, MagicMock
from fastapi.testclient import TestClient
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.product_master import router
from app.models.product_master import ProductMaster
from app.models.user import User
from app.core.deps import get_current_user
from app.db.session import get_db


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_test_app(mock_db: AsyncSession, mock_user: User) -> FastAPI:
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


def make_mock_product(**kwargs) -> ProductMaster:
    p = MagicMock(spec=ProductMaster)
    p.id = kwargs.get("id", "prod-uuid-001")
    p.product_name = kwargs.get("product_name", "TIGER 미국S&P500")
    p.product_code = kwargs.get("product_code", "360750")
    p.risk_level = kwargs.get("risk_level", "성장형")
    p.region = kwargs.get("region", "미국")
    p.product_type = kwargs.get("product_type", "ETF")
    p.created_at = kwargs.get("created_at", None)
    p.updated_at = kwargs.get("updated_at", None)
    return p


# ---------------------------------------------------------------------------
# GET /api/v1/product-master
# ---------------------------------------------------------------------------

class TestListProductMaster:
    """Tests for GET /api/v1/product-master."""

    def test_list_returns_200_with_items(self):
        """Should return list of products."""
        products = [
            make_mock_product(product_name="TIGER 미국S&P500"),
            make_mock_product(id="prod-uuid-002", product_name="KODEX 국내채권"),
        ]
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = products

        mock_db = AsyncMock(spec=AsyncSession)
        mock_db.execute = AsyncMock(return_value=mock_result)

        app = make_test_app(mock_db, make_mock_user())
        with TestClient(app) as client:
            response = client.get("/api/v1/product-master")

        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) == 2

    def test_list_empty_returns_empty_list(self):
        """Empty table should return empty list."""
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = []

        mock_db = AsyncMock(spec=AsyncSession)
        mock_db.execute = AsyncMock(return_value=mock_result)

        app = make_test_app(mock_db, make_mock_user())
        with TestClient(app) as client:
            response = client.get("/api/v1/product-master")

        assert response.status_code == 200
        assert response.json() == []

    def test_list_requires_authentication(self):
        """Unauthenticated request should be rejected."""
        mock_db = AsyncMock(spec=AsyncSession)

        app = FastAPI()
        app.include_router(router, prefix="/api/v1")
        app.dependency_overrides[get_db] = lambda: mock_db

        with TestClient(app, raise_server_exceptions=False) as client:
            response = client.get("/api/v1/product-master")

        assert response.status_code in (401, 403, 422)


# ---------------------------------------------------------------------------
# GET /api/v1/product-master/lookup
# ---------------------------------------------------------------------------

class TestLookupProductMaster:
    """Tests for GET /api/v1/product-master/lookup."""

    def test_lookup_by_exact_name_returns_product(self):
        """Should return risk_level and region for matching product."""
        product = make_mock_product(
            product_name="TIGER 미국S&P500",
            risk_level="성장형",
            region="미국",
        )
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = product

        mock_db = AsyncMock(spec=AsyncSession)
        mock_db.execute = AsyncMock(return_value=mock_result)

        app = make_test_app(mock_db, make_mock_user())
        with TestClient(app) as client:
            response = client.get(
                "/api/v1/product-master/lookup",
                params={"name": "TIGER 미국S&P500"},
            )

        assert response.status_code == 200
        data = response.json()
        assert data["product_name"] == "TIGER 미국S&P500"
        assert data["risk_level"] == "성장형"
        assert data["region"] == "미국"

    def test_lookup_not_found_returns_404(self):
        """Should return 404 when product name not found."""
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None

        mock_db = AsyncMock(spec=AsyncSession)
        mock_db.execute = AsyncMock(return_value=mock_result)

        app = make_test_app(mock_db, make_mock_user())
        with TestClient(app) as client:
            response = client.get(
                "/api/v1/product-master/lookup",
                params={"name": "존재하지않는상품"},
            )

        assert response.status_code == 404

    def test_lookup_missing_name_param_returns_422(self):
        """Should return 422 when name query param is missing."""
        mock_db = AsyncMock(spec=AsyncSession)

        app = make_test_app(mock_db, make_mock_user())
        with TestClient(app) as client:
            response = client.get("/api/v1/product-master/lookup")

        assert response.status_code == 422


# ---------------------------------------------------------------------------
# POST /api/v1/product-master
# ---------------------------------------------------------------------------

class TestCreateProductMaster:
    """Tests for POST /api/v1/product-master."""

    def test_create_returns_201(self):
        """Should create a new product and return 201."""
        created = make_mock_product(product_name="신규ETF", risk_level="안정형", region="국내")

        mock_db = AsyncMock(spec=AsyncSession)
        mock_db.add = MagicMock()
        mock_db.commit = AsyncMock()
        mock_db.refresh = AsyncMock(side_effect=lambda obj: None)

        # First execute: check duplicate → None
        dup_result = MagicMock()
        dup_result.scalar_one_or_none.return_value = None
        mock_db.execute = AsyncMock(return_value=dup_result)

        app = make_test_app(mock_db, make_mock_user())
        payload = {
            "product_name": "신규ETF",
            "product_code": "123456",
            "risk_level": "안정형",
            "region": "국내",
            "product_type": "ETF",
        }
        with TestClient(app) as client:
            response = client.post("/api/v1/product-master", json=payload)

        assert response.status_code == 201
        mock_db.add.assert_called_once()
        mock_db.commit.assert_awaited_once()

    def test_create_duplicate_name_returns_409(self):
        """Should return 409 when product_name already exists."""
        existing = make_mock_product(product_name="중복ETF")

        dup_result = MagicMock()
        dup_result.scalar_one_or_none.return_value = existing

        mock_db = AsyncMock(spec=AsyncSession)
        mock_db.execute = AsyncMock(return_value=dup_result)

        app = make_test_app(mock_db, make_mock_user())
        payload = {"product_name": "중복ETF", "risk_level": "성장형", "region": "미국"}
        with TestClient(app) as client:
            response = client.post("/api/v1/product-master", json=payload)

        assert response.status_code == 409

    def test_create_missing_required_field_returns_422(self):
        """product_name is required; omitting it should return 422."""
        mock_db = AsyncMock(spec=AsyncSession)

        app = make_test_app(mock_db, make_mock_user())
        with TestClient(app) as client:
            response = client.post(
                "/api/v1/product-master",
                json={"risk_level": "성장형"},
            )

        assert response.status_code == 422

    def test_create_requires_authentication(self):
        """Unauthenticated POST should be rejected."""
        mock_db = AsyncMock(spec=AsyncSession)

        app = FastAPI()
        app.include_router(router, prefix="/api/v1")
        app.dependency_overrides[get_db] = lambda: mock_db

        with TestClient(app, raise_server_exceptions=False) as client:
            response = client.post(
                "/api/v1/product-master",
                json={"product_name": "Test", "risk_level": "안정형", "region": "국내"},
            )

        assert response.status_code in (401, 403, 422)


# ---------------------------------------------------------------------------
# PUT /api/v1/product-master/{id}
# ---------------------------------------------------------------------------

class TestUpdateProductMaster:
    """Tests for PUT /api/v1/product-master/{id}."""

    def test_update_existing_returns_200(self):
        """Should update product and return 200."""
        product = make_mock_product(risk_level="성장형", region="미국")

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = product

        mock_db = AsyncMock(spec=AsyncSession)
        mock_db.execute = AsyncMock(return_value=mock_result)
        mock_db.commit = AsyncMock()
        mock_db.refresh = AsyncMock(side_effect=lambda obj: None)

        app = make_test_app(mock_db, make_mock_user())
        payload = {"risk_level": "절대성장형", "region": "글로벌"}
        with TestClient(app) as client:
            response = client.put("/api/v1/product-master/prod-uuid-001", json=payload)

        assert response.status_code == 200
        mock_db.commit.assert_awaited_once()

    def test_update_only_provided_fields(self):
        """PUT should only update fields present in payload."""
        product = make_mock_product(risk_level="성장형", region="미국")

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = product

        mock_db = AsyncMock(spec=AsyncSession)
        mock_db.execute = AsyncMock(return_value=mock_result)
        mock_db.commit = AsyncMock()
        mock_db.refresh = AsyncMock(side_effect=lambda obj: None)

        app = make_test_app(mock_db, make_mock_user())
        with TestClient(app) as client:
            response = client.put(
                "/api/v1/product-master/prod-uuid-001",
                json={"risk_level": "절대안정형"},
            )

        assert response.status_code == 200
        assert product.risk_level == "절대안정형"
        assert product.region == "미국"  # unchanged

    def test_update_not_found_returns_404(self):
        """Should return 404 when id does not exist."""
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None

        mock_db = AsyncMock(spec=AsyncSession)
        mock_db.execute = AsyncMock(return_value=mock_result)

        app = make_test_app(mock_db, make_mock_user())
        with TestClient(app) as client:
            response = client.put(
                "/api/v1/product-master/nonexistent-id",
                json={"risk_level": "안정형"},
            )

        assert response.status_code == 404


# ---------------------------------------------------------------------------
# DELETE /api/v1/product-master/{id}
# ---------------------------------------------------------------------------

class TestDeleteProductMaster:
    """Tests for DELETE /api/v1/product-master/{id}."""

    def test_delete_existing_returns_204(self):
        """Should delete product and return 204."""
        product = make_mock_product()

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = product

        mock_db = AsyncMock(spec=AsyncSession)
        mock_db.execute = AsyncMock(return_value=mock_result)
        mock_db.delete = AsyncMock()
        mock_db.commit = AsyncMock()

        app = make_test_app(mock_db, make_mock_user())
        with TestClient(app) as client:
            response = client.delete("/api/v1/product-master/prod-uuid-001")

        assert response.status_code == 204
        mock_db.delete.assert_awaited_once_with(product)
        mock_db.commit.assert_awaited_once()

    def test_delete_not_found_returns_404(self):
        """Should return 404 when id does not exist."""
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None

        mock_db = AsyncMock(spec=AsyncSession)
        mock_db.execute = AsyncMock(return_value=mock_result)

        app = make_test_app(mock_db, make_mock_user())
        with TestClient(app) as client:
            response = client.delete("/api/v1/product-master/nonexistent-id")

        assert response.status_code == 404

    def test_delete_requires_authentication(self):
        """Unauthenticated DELETE should be rejected."""
        mock_db = AsyncMock(spec=AsyncSession)

        app = FastAPI()
        app.include_router(router, prefix="/api/v1")
        app.dependency_overrides[get_db] = lambda: mock_db

        with TestClient(app, raise_server_exceptions=False) as client:
            response = client.delete("/api/v1/product-master/some-id")

        assert response.status_code in (401, 403, 422)


# ---------------------------------------------------------------------------
# Schema Tests
# ---------------------------------------------------------------------------

class TestProductMasterSchemas:
    """Tests for Pydantic schema validation."""

    def test_create_schema_requires_product_name(self):
        from pydantic import ValidationError
        from app.schemas.product_master import ProductMasterCreate
        with pytest.raises(ValidationError):
            ProductMasterCreate()  # product_name missing

    def test_create_schema_all_optional_except_name(self):
        from app.schemas.product_master import ProductMasterCreate
        obj = ProductMasterCreate(product_name="테스트")
        assert obj.product_name == "테스트"
        assert obj.product_code is None
        assert obj.risk_level is None
        assert obj.region is None
        assert obj.product_type is None

    def test_update_schema_all_optional(self):
        from app.schemas.product_master import ProductMasterUpdate
        obj = ProductMasterUpdate()
        assert obj.risk_level is None
        assert obj.region is None

    def test_update_schema_exclude_unset(self):
        from app.schemas.product_master import ProductMasterUpdate
        obj = ProductMasterUpdate(risk_level="안정형")
        dumped = obj.model_dump(exclude_unset=True)
        assert "risk_level" in dumped
        assert "region" not in dumped

    def test_response_schema_from_attributes(self):
        from app.schemas.product_master import ProductMasterResponse
        data = {
            "id": "abc-123",
            "product_name": "TIGER S&P500",
            "product_code": "360750",
            "risk_level": "성장형",
            "region": "미국",
            "product_type": "ETF",
            "created_at": None,
            "updated_at": None,
        }
        resp = ProductMasterResponse.model_validate(data)
        assert resp.id == "abc-123"
        assert resp.product_name == "TIGER S&P500"
        assert resp.risk_level == "성장형"

    def test_product_name_max_length_constraint(self):
        from pydantic import ValidationError
        from app.schemas.product_master import ProductMasterCreate
        with pytest.raises(ValidationError):
            ProductMasterCreate(product_name="A" * 301)  # max 300
