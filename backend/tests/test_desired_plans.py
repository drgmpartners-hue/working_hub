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
    """Verify compound calculation service logic.

    리팩터링으로 구 API(calculate_target_total_fund/calculate_required_lump_sum,
    단리식 연산)가 엑셀 PV/FV 기반(월복리·기초납) 신규 API로 교체됨.
    현재 앱 계약(수식)에 맞춰 기대값을 재계산해 갱신했다.
    """

    def test_import_service(self):
        from app.services.compound_calc import CompoundCalcService
        assert CompoundCalcService is not None

    def test_calculate_target_total_fund(self):
        """목표 은퇴자금 = 은퇴기간 월수령액 연금의 현재가치 (월복리, 기초납 PV)."""
        from app.services.compound_calc import CompoundCalcService

        # 월 200만 원, 연금수익률 5%, 20년 수령 (물가 미반영)
        result = CompoundCalcService.calculate_target_fund(
            future_monthly=2_000_000,
            pension_return_rate=0.05,
            inflation_rate=0.021,
            retirement_period_years=20,
            with_inflation=False,
        )
        # 기대값: 엑셀 PV(r/12, n*12, pmt, type=1)와 동일한 기초납 연금 현가
        r = 0.05 / 12
        n = 20 * 12
        pvif = (1 + r) ** n
        expected = 2_000_000 * (pvif - 1) / r * (1 + r) / pvif
        assert abs(result - expected) < 1  # within 1 won

    def test_calculate_required_lump_sum(self):
        """필요 거치금 역산: 적립 0원일 때 PV = FV / (1+r/12)^(n*12) (월복리 할인)."""
        from app.services.compound_calc import CompoundCalcService

        # FV=480,000,000, r=7%, 총 20년 (적립 20년 + 거치 0년, 연적립 0원)
        result = CompoundCalcService.calculate_required_holding(
            target_fund=480_000_000,
            expected_return_rate=0.07,
            savings_period=20,
            holding_period=0,
            annual_savings=0,
        )
        # 구 버전은 연복리(1.07^20)였으나 현재는 월복리 할인
        expected = 480_000_000 / ((1 + 0.07 / 12) ** (20 * 12))
        assert abs(result - expected) < 1  # within 1 won

    def test_calculate_required_annual_savings(self):
        """필요 연간 적립액 역산: 월납 PMT = FV * (r/12) / ((1+r/12)^(n*12) - 1), 연액 = ×12."""
        from app.services.compound_calc import CompoundCalcService

        # FV=480,000,000, r=7%, 적립 20년, 거치 0년
        result = CompoundCalcService.calculate_required_annual_savings(
            target_fund=480_000_000,
            expected_return_rate=0.07,
            savings_period=20,
            holding_period=0,
        )
        # 구 버전은 연복리 PMT였으나 현재는 월복리 월납 PMT × 12
        r = 0.07 / 12
        pvif = (1 + r) ** (20 * 12)
        expected = 480_000_000 * r / (pvif - 1) * 12
        assert abs(result - expected) < 1  # within 1 won

    def test_calculate_all_returns_dict(self):
        """calculate_all returns a dict with all computed fields."""
        from app.services.compound_calc import CompoundCalcService

        # 시그니처 변경: retirement_age/current_age/savings_period/annual_savings 필수
        result = CompoundCalcService.calculate_all(
            monthly_desired_amount=2_000_000,
            retirement_age=60,
            current_age=40,
            retirement_period_years=20,
            savings_period=10,
            annual_savings=12_000_000,
        )
        assert isinstance(result, dict)
        # 신규 키 + 하위 호환 키 모두 존재해야 함
        assert "target_fund" in result
        assert "required_holding" in result
        assert "simulation_table" in result
        assert "target_total_fund" in result
        assert "required_lump_sum" in result
        assert "required_annual_savings" in result
        assert "calculation_params" in result

    def test_default_rate_is_7_percent(self):
        """Default expected_return_rate should be 7%."""
        from app.services.compound_calc import CompoundCalcService

        result = CompoundCalcService.calculate_all(
            monthly_desired_amount=1_000_000,
            retirement_age=55,
            current_age=45,
            retirement_period_years=10,
            savings_period=10,
            annual_savings=0,
        )
        params = result["calculation_params"]
        # 파라미터 키가 annual_rate → expected_return_rate 로 변경됨
        assert params["expected_return_rate"] == 0.07

    def test_calculation_params_stored(self):
        """calculation_params must record the inputs used."""
        from app.services.compound_calc import CompoundCalcService

        result = CompoundCalcService.calculate_all(
            monthly_desired_amount=3_000_000,
            retirement_age=60,
            current_age=45,
            retirement_period_years=25,
            savings_period=10,
            annual_savings=24_000_000,
            expected_return_rate=0.05,
        )
        params = result["calculation_params"]
        assert params["monthly_desired_amount"] == 3_000_000
        assert params["retirement_period_years"] == 25
        assert params["savings_period"] == 10
        # annual_savings 는 자동 보정될 수 있으므로 원본은 original_annual_savings 에 저장됨
        assert params["original_annual_savings"] == 24_000_000
        assert params["expected_return_rate"] == 0.05

    def test_zero_years_to_retirement(self):
        """현재 계약: 은퇴나이 <= 현재나이(투자기간 0)면 ValueError (라우터가 422로 변환)."""
        from app.services.compound_calc import CompoundCalcService

        with pytest.raises(ValueError):
            CompoundCalcService.calculate_all(
                monthly_desired_amount=1_000_000,
                retirement_age=60,
                current_age=60,
                retirement_period_years=10,
                savings_period=1,
                annual_savings=0,
            )


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
        """현재 계약: 필수는 monthly_desired_amount/retirement_age/current_age/savings_period.

        retirement_period_years 는 기본값 40인 선택 필드로 변경됨.
        """
        from app.schemas.desired_plan import DesiredPlanUpsert

        schema = DesiredPlanUpsert(
            monthly_desired_amount=2_000_000,
            retirement_age=60,
            current_age=40,
            savings_period=10,
        )
        assert schema.monthly_desired_amount == 2_000_000
        assert schema.retirement_period_years == 40  # 기본값

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

        # 필수 필드를 채워서 monthly_desired_amount=-1 자체가 실패 원인이 되도록 함
        with pytest.raises((pydantic.ValidationError, ValueError)):
            DesiredPlanUpsert(
                monthly_desired_amount=-1,
                retirement_age=60,
                current_age=40,
                savings_period=10,
            )

    def test_upsert_retirement_period_positive(self):
        """retirement_period_years must be positive."""
        from app.schemas.desired_plan import DesiredPlanUpsert
        import pydantic

        # 필수 필드를 채워서 retirement_period_years=0 자체가 실패 원인이 되도록 함
        with pytest.raises((pydantic.ValidationError, ValueError)):
            DesiredPlanUpsert(
                monthly_desired_amount=1_000_000,
                retirement_age=60,
                current_age=40,
                savings_period=10,
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
        # route.path 는 prefix 를 포함한 전체 경로임 (현재 FastAPI 동작)
        paths = {route.path for route in router.routes}
        assert "/retirement/desired-plans/{customer_id}" in paths, (
            "GET/PUT /{customer_id} route missing"
        )

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
        # route.path 는 prefix 포함 전체 경로
        get_routes = [
            r for r in router.routes
            if r.path == "/retirement/desired-plans/{customer_id}" and "GET" in r.methods
        ]
        assert len(get_routes) == 1, "GET /{customer_id} route missing"

    def test_put_route_method(self):
        from app.api.v1 import desired_plans

        router = desired_plans.router
        # route.path 는 prefix 포함 전체 경로
        put_routes = [
            r for r in router.routes
            if r.path == "/retirement/desired-plans/{customer_id}" and "PUT" in r.methods
        ]
        assert len(put_routes) == 1, "PUT /{customer_id} route missing"
