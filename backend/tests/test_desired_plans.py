"""Tests for desired_plans model, service, and API.

P2-R3-T1: DesiredPlan model + migration
P2-R3-T2: Desired Plans API + compound calculation service
"""
import pytest
from datetime import datetime


# ---------------------------------------------------------------------------
# P2-R3-T1: Model Tests
# ---------------------------------------------------------------------------

class TestDesiredPlanModelImport:
    """Verify DesiredPlan model can be imported and has correct schema."""

    def test_import_model(self):
        from app.models.desired_plan import DesiredPlan
        assert DesiredPlan.__tablename__ == "desired_plans"

    def test_model_columns_exist(self):
        from app.db.base import Base
        import app.models  # noqa: F401

        table = Base.metadata.tables["desired_plans"]
        col_names = set(table.columns.keys())
        required = {
            "id",
            "profile_id",
            "monthly_desired_amount",
            "retirement_period_years",
            "target_total_fund",
            "required_lump_sum",
            "required_annual_savings",
            "calculation_params",
            "created_at",
            "updated_at",
        }
        missing = required - col_names
        assert not missing, f"Missing columns: {missing}"

    def test_profile_id_fk_to_customer_retirement_profiles(self):
        from app.db.base import Base
        import app.models  # noqa: F401

        table = Base.metadata.tables["desired_plans"]
        fk_targets = {
            fk.column.table.name
            for col in table.columns
            for fk in col.foreign_keys
        }
        assert "customer_retirement_profiles" in fk_targets, (
            "profile_id must FK to customer_retirement_profiles table"
        )

    def test_package_exports_model(self):
        import app.models as models
        assert hasattr(models, "DesiredPlan"), (
            "app.models must export DesiredPlan"
        )

    def test_monthly_desired_amount_not_nullable(self):
        from app.db.base import Base
        import app.models  # noqa: F401

        table = Base.metadata.tables["desired_plans"]
        col = table.columns["monthly_desired_amount"]
        assert not col.nullable, "monthly_desired_amount must be NOT NULL"

    def test_retirement_period_years_not_nullable(self):
        from app.db.base import Base
        import app.models  # noqa: F401

        table = Base.metadata.tables["desired_plans"]
        col = table.columns["retirement_period_years"]
        assert not col.nullable, "retirement_period_years must be NOT NULL"


# ---------------------------------------------------------------------------
# P2-R3-T2: Compound Calculation Service Tests
# ---------------------------------------------------------------------------

class TestCompoundCalcService:
    """Verify compound calculation (복리 역산) service logic."""

    def test_import_service(self):
        from app.services.compound_calc import CompoundCalcService
        assert CompoundCalcService is not None

    def test_calculate_target_total_fund(self):
        """목표 은퇴자금 = 월 희망 수령액 × 12 × 은퇴기간(년)."""
        from app.services.compound_calc import CompoundCalcService

        # 월 200만 원, 20년 은퇴기간
        result = CompoundCalcService.calculate_target_total_fund(
            monthly_desired_amount=2_000_000,
            retirement_period_years=20,
        )
        assert result == 2_000_000 * 12 * 20  # 480,000,000

    def test_calculate_required_lump_sum(self):
        """필요 일시납 역산: PV = FV / (1+r)^n."""
        from app.services.compound_calc import CompoundCalcService

        # FV=480,000,000, r=7%, n=20 years
        result = CompoundCalcService.calculate_required_lump_sum(
            target_total_fund=480_000_000,
            years_to_retirement=20,
            annual_rate=0.07,
        )
        # PV = 480_000_000 / (1.07^20) ≈ 124,294,XXX
        expected = 480_000_000 / (1.07 ** 20)
        assert abs(result - expected) < 1  # within 1 won

    def test_calculate_required_annual_savings(self):
        """필요 연간 적립액 역산: PMT from FV formula."""
        from app.services.compound_calc import CompoundCalcService

        # FV=480,000,000, r=7%, n=20 years
        # PMT = FV * r / ((1+r)^n - 1)
        result = CompoundCalcService.calculate_required_annual_savings(
            target_total_fund=480_000_000,
            years_to_retirement=20,
            annual_rate=0.07,
        )
        expected = 480_000_000 * 0.07 / ((1.07 ** 20) - 1)
        assert abs(result - expected) < 1  # within 1 won

    def test_calculate_all_returns_dict(self):
        """calculate_all returns a dict with all computed fields."""
        from app.services.compound_calc import CompoundCalcService

        result = CompoundCalcService.calculate_all(
            monthly_desired_amount=2_000_000,
            retirement_period_years=20,
            years_to_retirement=20,
            annual_rate=0.07,
        )
        assert isinstance(result, dict)
        assert "target_total_fund" in result
        assert "required_lump_sum" in result
        assert "required_annual_savings" in result
        assert "calculation_params" in result

    def test_default_rate_is_7_percent(self):
        """Default annual rate should be 7%."""
        from app.services.compound_calc import CompoundCalcService

        result = CompoundCalcService.calculate_all(
            monthly_desired_amount=1_000_000,
            retirement_period_years=10,
            years_to_retirement=10,
        )
        params = result["calculation_params"]
        assert params["annual_rate"] == 0.07

    def test_calculation_params_stored(self):
        """calculation_params must record the inputs used."""
        from app.services.compound_calc import CompoundCalcService

        result = CompoundCalcService.calculate_all(
            monthly_desired_amount=3_000_000,
            retirement_period_years=25,
            years_to_retirement=15,
            annual_rate=0.05,
        )
        params = result["calculation_params"]
        assert params["monthly_desired_amount"] == 3_000_000
        assert params["retirement_period_years"] == 25
        assert params["years_to_retirement"] == 15
        assert params["annual_rate"] == 0.05

    def test_zero_years_to_retirement(self):
        """years_to_retirement=0 means lump sum equals target fund."""
        from app.services.compound_calc import CompoundCalcService

        result = CompoundCalcService.calculate_all(
            monthly_desired_amount=1_000_000,
            retirement_period_years=10,
            years_to_retirement=0,
            annual_rate=0.07,
        )
        # PV when n=0 → FV itself
        assert result["required_lump_sum"] == result["target_total_fund"]


# ---------------------------------------------------------------------------
# P2-R3-T2: Schema Tests
# ---------------------------------------------------------------------------

class TestDesiredPlanSchemas:
    """Verify Pydantic schemas for DesiredPlan."""

    def test_import_schemas(self):
        from app.schemas.desired_plan import (
            DesiredPlanUpsert,
            DesiredPlanResponse,
        )
        assert DesiredPlanUpsert is not None
        assert DesiredPlanResponse is not None

    def test_upsert_schema_required_fields(self):
        from app.schemas.desired_plan import DesiredPlanUpsert

        fields = DesiredPlanUpsert.model_fields
        assert "monthly_desired_amount" in fields
        assert "retirement_period_years" in fields

    def test_upsert_schema_optional_fields(self):
        """Only monthly_desired_amount and retirement_period_years are required."""
        from app.schemas.desired_plan import DesiredPlanUpsert

        # Should succeed with just the two required fields
        schema = DesiredPlanUpsert(
            monthly_desired_amount=2_000_000,
            retirement_period_years=20,
        )
        assert schema.monthly_desired_amount == 2_000_000
        assert schema.retirement_period_years == 20

    def test_response_schema_has_computed_fields(self):
        from app.schemas.desired_plan import DesiredPlanResponse

        fields = DesiredPlanResponse.model_fields
        assert "target_total_fund" in fields
        assert "required_lump_sum" in fields
        assert "required_annual_savings" in fields
        assert "calculation_params" in fields

    def test_response_schema_has_id_and_profile_id(self):
        from app.schemas.desired_plan import DesiredPlanResponse

        fields = DesiredPlanResponse.model_fields
        assert "id" in fields
        assert "profile_id" in fields

    def test_response_schema_from_attributes(self):
        """Response schema must support ORM mode (from_attributes=True)."""
        from app.schemas.desired_plan import DesiredPlanResponse

        config = DesiredPlanResponse.model_config
        assert config.get("from_attributes") is True

    def test_upsert_monthly_amount_positive(self):
        """monthly_desired_amount must be positive."""
        from app.schemas.desired_plan import DesiredPlanUpsert
        import pydantic

        with pytest.raises((pydantic.ValidationError, ValueError)):
            DesiredPlanUpsert(
                monthly_desired_amount=-1,
                retirement_period_years=20,
            )

    def test_upsert_retirement_period_positive(self):
        """retirement_period_years must be positive."""
        from app.schemas.desired_plan import DesiredPlanUpsert
        import pydantic

        with pytest.raises((pydantic.ValidationError, ValueError)):
            DesiredPlanUpsert(
                monthly_desired_amount=1_000_000,
                retirement_period_years=0,
            )


# ---------------------------------------------------------------------------
# P2-R3-T2: Router Tests
# ---------------------------------------------------------------------------

class TestDesiredPlansRouter:
    """Verify desired_plans router is importable and has correct paths."""

    def test_import_router(self):
        from app.api.v1 import desired_plans
        assert desired_plans.router is not None

    def test_router_prefix(self):
        from app.api.v1 import desired_plans

        router = desired_plans.router
        assert router.prefix == "/retirement/desired-plans", (
            f"Expected prefix '/retirement/desired-plans', got '{router.prefix}'"
        )

    def test_router_has_get_and_put_routes(self):
        from app.api.v1 import desired_plans

        router = desired_plans.router
        paths = {route.path for route in router.routes}
        assert "/{customer_id}" in paths, "GET/PUT /{customer_id} route missing"

    def test_router_registered_in_main_app(self):
        from app.main import app

        included_paths = set()
        for route in app.routes:
            if hasattr(route, "path"):
                included_paths.add(route.path)

        desired_routes = [
            p for p in included_paths if "desired-plans" in p
        ]
        assert len(desired_routes) > 0, (
            "No desired-plans routes found in app. "
            "Did you forget to include the router in main.py?"
        )

    def test_get_route_method(self):
        from app.api.v1 import desired_plans

        router = desired_plans.router
        get_routes = [
            r for r in router.routes
            if r.path == "/{customer_id}" and "GET" in r.methods
        ]
        assert len(get_routes) == 1, "GET /{customer_id} route missing"

    def test_put_route_method(self):
        from app.api.v1 import desired_plans

        router = desired_plans.router
        put_routes = [
            r for r in router.routes
            if r.path == "/{customer_id}" and "PUT" in r.methods
        ]
        assert len(put_routes) == 1, "PUT /{customer_id} route missing"
