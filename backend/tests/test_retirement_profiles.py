"""Tests for customer_retirement_profiles model and API."""
import pytest


# ---------------------------------------------------------------------------
# P2-R1-T1: Model Tests (RED - implementation not yet created)
# ---------------------------------------------------------------------------

class TestRetirementProfileModelImport:
    """Verify CustomerRetirementProfile model can be imported and has correct schema."""

    def test_import_model(self):
        from app.models.customer_retirement_profile import CustomerRetirementProfile
        assert CustomerRetirementProfile.__tablename__ == "customer_retirement_profiles"

    def test_model_columns_exist(self):
        from app.models.customer_retirement_profile import CustomerRetirementProfile
        from app.db.base import Base
        import app.models  # noqa: F401

        table = Base.metadata.tables["customer_retirement_profiles"]
        col_names = set(table.columns.keys())
        required = {
            "id",
            "customer_id",
            "target_retirement_fund",
            "desired_pension_amount",
            "age_at_design",
            "current_age",
            "desired_retirement_age",
            "created_at",
            "updated_at",
        }
        missing = required - col_names
        assert not missing, f"Missing columns: {missing}"

    def test_customer_id_is_unique(self):
        from app.db.base import Base
        import app.models  # noqa: F401

        table = Base.metadata.tables["customer_retirement_profiles"]
        customer_id_col = table.columns["customer_id"]
        assert customer_id_col.unique, "customer_id must have a UNIQUE constraint"

    def test_customer_id_fk_to_users(self):
        from app.db.base import Base
        import app.models  # noqa: F401

        table = Base.metadata.tables["customer_retirement_profiles"]
        fk_targets = {
            fk.column.table.name
            for col in table.columns
            for fk in col.foreign_keys
        }
        assert "users" in fk_targets, "customer_id must FK to users table"

    def test_package_exports_model(self):
        import app.models as models
        assert hasattr(models, "CustomerRetirementProfile"), (
            "app.models must export CustomerRetirementProfile"
        )


# ---------------------------------------------------------------------------
# P2-R1-T2: Schema Tests
# ---------------------------------------------------------------------------

class TestRetirementProfileSchemas:
    """Verify Pydantic schemas are importable and have correct fields."""

    def test_import_schemas(self):
        from app.schemas.retirement import (
            CustomerRetirementProfileCreate,
            CustomerRetirementProfileUpdate,
            CustomerRetirementProfileResponse,
        )
        assert CustomerRetirementProfileCreate is not None
        assert CustomerRetirementProfileUpdate is not None
        assert CustomerRetirementProfileResponse is not None

    def test_create_schema_required_fields(self):
        from app.schemas.retirement import CustomerRetirementProfileCreate
        import inspect

        fields = CustomerRetirementProfileCreate.model_fields
        assert "target_retirement_fund" in fields
        assert "desired_pension_amount" in fields
        assert "age_at_design" in fields
        assert "current_age" in fields
        assert "desired_retirement_age" in fields

    def test_update_schema_all_optional(self):
        from app.schemas.retirement import CustomerRetirementProfileUpdate

        # All fields should be optional (allow partial update)
        schema = CustomerRetirementProfileUpdate()  # must not raise
        assert schema is not None

    def test_response_schema_has_id_and_customer_id(self):
        from app.schemas.retirement import CustomerRetirementProfileResponse

        fields = CustomerRetirementProfileResponse.model_fields
        assert "id" in fields
        assert "customer_id" in fields

    def test_create_schema_validation(self):
        from app.schemas.retirement import CustomerRetirementProfileCreate

        profile = CustomerRetirementProfileCreate(
            target_retirement_fund=500_000_000,
            desired_pension_amount=2_000_000,
            age_at_design=40,
            current_age=40,
            desired_retirement_age=65,
        )
        assert profile.target_retirement_fund == 500_000_000
        assert profile.desired_pension_amount == 2_000_000
        assert profile.age_at_design == 40
        assert profile.current_age == 40
        assert profile.desired_retirement_age == 65

    def test_update_schema_partial_update(self):
        from app.schemas.retirement import CustomerRetirementProfileUpdate

        update = CustomerRetirementProfileUpdate(current_age=41)
        assert update.current_age == 41
        assert update.target_retirement_fund is None


# ---------------------------------------------------------------------------
# P2-R1-T2: Router Tests (unit-level: router is importable and has correct paths)
# ---------------------------------------------------------------------------

class TestRetirementProfileRouter:
    """Verify retirement profiles router is importable and registered."""

    def test_import_router(self):
        from app.api.v1 import retirement_profiles
        assert retirement_profiles.router is not None

    def test_router_prefix(self):
        from app.api.v1 import retirement_profiles

        router = retirement_profiles.router
        assert router.prefix == "/retirement/profiles", (
            f"Expected prefix '/retirement/profiles', got '{router.prefix}'"
        )

    def test_router_has_required_routes(self):
        from app.api.v1 import retirement_profiles

        router = retirement_profiles.router
        paths = {route.path for route in router.routes}
        # GET list (prefix already contains /retirement/profiles, so route path is "")
        assert "" in paths or "/" in paths, "GET list route missing"
        # GET by customer_id
        assert "/{customer_id}" in paths, "GET /{customer_id} route missing"

    def test_router_registered_in_main_app(self):
        from app.main import app

        included_paths = set()
        for route in app.routes:
            if hasattr(route, "path"):
                included_paths.add(route.path)

        # Check that retirement profiles routes are present in the app
        retirement_routes = [
            p for p in included_paths if "retirement" in p
        ]
        assert len(retirement_routes) > 0, (
            "No retirement routes found in app. "
            "Did you forget to include the router in main.py?"
        )


# ---------------------------------------------------------------------------
# P2-R1-T2: CRUD Logic Tests (in-memory, no DB required)
# ---------------------------------------------------------------------------

class TestRetirementProfileCRUD:
    """Verify CRUD operations logic via schema round-trips."""

    def test_create_profile_schema_round_trip(self):
        from app.schemas.retirement import (
            CustomerRetirementProfileCreate,
            CustomerRetirementProfileResponse,
        )
        from datetime import datetime

        create_data = CustomerRetirementProfileCreate(
            target_retirement_fund=1_000_000_000,
            desired_pension_amount=3_000_000,
            age_at_design=35,
            current_age=35,
            desired_retirement_age=60,
        )

        # Simulate what the DB response would look like
        response_data = {
            "id": "abc123",
            "customer_id": "user-uuid-1234",
            **create_data.model_dump(),
            "created_at": datetime.now(),
            "updated_at": datetime.now(),
        }
        response = CustomerRetirementProfileResponse.model_validate(response_data)
        assert response.id == "abc123"
        assert response.customer_id == "user-uuid-1234"
        assert response.target_retirement_fund == 1_000_000_000

    def test_update_profile_schema_partial(self):
        from app.schemas.retirement import CustomerRetirementProfileUpdate

        update = CustomerRetirementProfileUpdate(
            target_retirement_fund=800_000_000
        )
        dumped = update.model_dump(exclude_unset=True)
        assert "target_retirement_fund" in dumped
        assert "desired_pension_amount" not in dumped
