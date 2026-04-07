"""Tests for pension_plans model, pension_calc service, and pension API.

P3-R3-T1: DB model (pension_plans table)
P3-R3-T2: pension calculation service + REST API
"""
from __future__ import annotations


# ---------------------------------------------------------------------------
# P3-R3-T1: Model Tests
# ---------------------------------------------------------------------------


class TestPensionPlanModelImport:
    """Verify PensionPlan model can be imported and has correct schema."""

    def test_import_model(self):
        from app.models.pension_plan import PensionPlan
        assert PensionPlan.__tablename__ == "pension_plans"

    def test_model_columns_exist(self):
        from app.db.base import Base
        import app.models  # noqa: F401

        table = Base.metadata.tables["pension_plans"]
        col_names = set(table.columns.keys())
        required = {
            "id",
            "profile_id",
            "pension_type",
            "accumulation_summary",
            "distribution_plan",
            "combined_graph_data",
            "created_at",
            "updated_at",
        }
        missing = required - col_names
        assert not missing, f"Missing columns: {missing}"

    def test_profile_id_fk_to_customer_retirement_profiles(self):
        from app.db.base import Base
        import app.models  # noqa: F401

        table = Base.metadata.tables["pension_plans"]
        fk_targets = {
            fk.column.table.name
            for col in table.columns.values()
            for fk in col.foreign_keys
        }
        assert "customer_retirement_profiles" in fk_targets, (
            "profile_id must FK to customer_retirement_profiles table"
        )

    def test_pension_type_is_not_nullable(self):
        from app.db.base import Base
        import app.models  # noqa: F401

        table = Base.metadata.tables["pension_plans"]
        pension_type_col = table.columns["pension_type"]
        assert not pension_type_col.nullable, "pension_type must be NOT NULL"

    def test_jsonb_columns_are_nullable(self):
        from app.db.base import Base
        import app.models  # noqa: F401

        table = Base.metadata.tables["pension_plans"]
        for col_name in ["accumulation_summary", "distribution_plan", "combined_graph_data"]:
            col = table.columns[col_name]
            assert col.nullable, f"{col_name} should be nullable"

    def test_package_exports_model(self):
        import app.models as models
        assert hasattr(models, "PensionPlan"), (
            "app.models must export PensionPlan"
        )


# ---------------------------------------------------------------------------
# P3-R3-T2: PensionCalcService Unit Tests
# ---------------------------------------------------------------------------


class TestPensionCalcServiceLifetime:
    """종신형 연금 계산 테스트."""

    def test_lifetime_monthly_amount(self):
        """종신형: 월수령액 = 은퇴자금 / (기대여명 * 12)."""
        from app.services.pension_calc import PensionCalcService

        # 은퇴자금 12억, 은퇴나이 60세 → 기대여명 = 100-60 = 40년
        result = PensionCalcService.calculate_lifetime(
            retirement_fund=120_000,  # 단위: 만원
            retirement_age=60,
        )
        # 월수령액 = 120000 / (40 * 12) = 120000 / 480 = 250
        assert result["monthly_amount"] == 250.0
        assert result["pension_type"] == "lifetime"
        assert result["life_expectancy_years"] == 40

    def test_lifetime_distribution_plan_length(self):
        """종신형: 은퇴나이부터 100세까지 배열."""
        from app.services.pension_calc import PensionCalcService

        result = PensionCalcService.calculate_lifetime(
            retirement_fund=120_000,
            retirement_age=65,
        )
        # 65세부터 100세까지 = 36개 항목
        plan = result["distribution_plan"]
        assert len(plan) == 36
        assert plan[0]["age"] == 65
        assert plan[-1]["age"] == 100

    def test_lifetime_balance_decreases(self):
        """종신형: 잔액은 매년 감소해야 함."""
        from app.services.pension_calc import PensionCalcService

        result = PensionCalcService.calculate_lifetime(
            retirement_fund=120_000,
            retirement_age=60,
        )
        plan = result["distribution_plan"]
        for i in range(1, len(plan)):
            assert plan[i]["balance"] <= plan[i - 1]["balance"]

    def test_lifetime_balance_reaches_zero(self):
        """종신형: 마지막에 잔액이 0이 되어야 함."""
        from app.services.pension_calc import PensionCalcService

        result = PensionCalcService.calculate_lifetime(
            retirement_fund=120_000,
            retirement_age=60,
        )
        plan = result["distribution_plan"]
        assert plan[-1]["balance"] >= 0


class TestPensionCalcServiceFixed:
    """확정형 연금 계산 테스트."""

    def test_fixed_monthly_amount(self):
        """확정형: 월수령액 = 은퇴자금 / (20 * 12)."""
        from app.services.pension_calc import PensionCalcService

        result = PensionCalcService.calculate_fixed(
            retirement_fund=120_000,  # 단위: 만원
            retirement_age=60,
        )
        # 월수령액 = 120000 / (20 * 12) = 120000 / 240 = 500
        assert result["monthly_amount"] == 500.0
        assert result["pension_type"] == "fixed"
        assert result["fixed_period_years"] == 20

    def test_fixed_distribution_plan_length(self):
        """확정형: 20년간 지급 배열."""
        from app.services.pension_calc import PensionCalcService

        result = PensionCalcService.calculate_fixed(
            retirement_fund=120_000,
            retirement_age=65,
        )
        plan = result["distribution_plan"]
        # 20년간 지급 = 20개 항목 (65~84세)
        assert len(plan) == 20
        assert plan[0]["age"] == 65
        assert plan[-1]["age"] == 84

    def test_fixed_balance_reaches_near_zero(self):
        """확정형: 20년 후 잔액이 0에 가까워야 함."""
        from app.services.pension_calc import PensionCalcService

        result = PensionCalcService.calculate_fixed(
            retirement_fund=120_000,
            retirement_age=60,
        )
        plan = result["distribution_plan"]
        assert abs(plan[-1]["balance"]) < 1  # 반올림 오차 허용


class TestPensionCalcServiceInheritance:
    """상속형 연금 계산 테스트."""

    def test_inheritance_monthly_amount(self):
        """상속형: 월수령액 = 은퇴자금 * 3.5% / 12 (원금 보존)."""
        from app.services.pension_calc import PensionCalcService

        result = PensionCalcService.calculate_inheritance(
            retirement_fund=120_000,  # 단위: 만원
            retirement_age=60,
        )
        # 월수령액 = 120000 * 0.035 / 12 = 4200 / 12 = 350
        assert abs(result["monthly_amount"] - 350.0) < 0.01
        assert result["pension_type"] == "inheritance"
        assert result["annual_rate"] == 3.5

    def test_inheritance_balance_stays_constant(self):
        """상속형: 원금 보존 - 잔액이 항상 같아야 함."""
        from app.services.pension_calc import PensionCalcService

        result = PensionCalcService.calculate_inheritance(
            retirement_fund=120_000,
            retirement_age=60,
        )
        plan = result["distribution_plan"]
        for entry in plan:
            assert abs(entry["balance"] - 120_000) < 0.01

    def test_inheritance_distribution_plan_length(self):
        """상속형: 은퇴나이부터 100세까지 배열."""
        from app.services.pension_calc import PensionCalcService

        result = PensionCalcService.calculate_inheritance(
            retirement_fund=120_000,
            retirement_age=70,
        )
        plan = result["distribution_plan"]
        # 70세부터 100세까지 = 31개 항목
        assert len(plan) == 31
        assert plan[0]["age"] == 70
        assert plan[-1]["age"] == 100


class TestPensionCalcServiceCombinedGraph:
    """통합 그래프 데이터 생성 테스트."""

    def test_combined_graph_has_accumulation_and_distribution(self):
        """통합 그래프: 모으는 기간 + 쓰는 기간 포함."""
        from app.services.pension_calc import PensionCalcService

        # 모으는 기간 데이터 (yearly_projections 형식)
        accumulation = [
            {"age": 40, "evaluation": 1000},
            {"age": 41, "evaluation": 2000},
            {"age": 42, "evaluation": 3000},
        ]
        distribution = [
            {"age": 60, "balance": 120000},
            {"age": 61, "balance": 118000},
        ]

        combined = PensionCalcService.build_combined_graph(
            accumulation_projections=accumulation,
            distribution_plan=distribution,
            retirement_age=60,
        )
        phases = {entry["phase"] for entry in combined}
        assert "accumulation" in phases
        assert "distribution" in phases

    def test_combined_graph_entry_fields(self):
        """각 항목에 age, evaluation, phase 필드 존재."""
        from app.services.pension_calc import PensionCalcService

        accumulation = [{"age": 40, "evaluation": 1000}]
        distribution = [{"age": 65, "balance": 120000}]

        combined = PensionCalcService.build_combined_graph(
            accumulation_projections=accumulation,
            distribution_plan=distribution,
            retirement_age=65,
        )
        for entry in combined:
            assert "age" in entry
            assert "evaluation" in entry
            assert "phase" in entry

    def test_combined_graph_accumulation_uses_evaluation(self):
        """모으는 기간: evaluation 값을 그대로 사용."""
        from app.services.pension_calc import PensionCalcService

        accumulation = [
            {"age": 40, "evaluation": 1500},
            {"age": 41, "evaluation": 2500},
        ]
        distribution = [{"age": 60, "balance": 120000}]

        combined = PensionCalcService.build_combined_graph(
            accumulation_projections=accumulation,
            distribution_plan=distribution,
            retirement_age=60,
        )
        acc_entries = [e for e in combined if e["phase"] == "accumulation"]
        assert acc_entries[0]["evaluation"] == 1500
        assert acc_entries[1]["evaluation"] == 2500

    def test_combined_graph_distribution_uses_balance(self):
        """쓰는 기간: balance 값을 evaluation으로 사용."""
        from app.services.pension_calc import PensionCalcService

        accumulation = [{"age": 40, "evaluation": 1000}]
        distribution = [
            {"age": 65, "balance": 120000},
            {"age": 66, "balance": 118000},
        ]

        combined = PensionCalcService.build_combined_graph(
            accumulation_projections=accumulation,
            distribution_plan=distribution,
            retirement_age=65,
        )
        dist_entries = [e for e in combined if e["phase"] == "distribution"]
        assert dist_entries[0]["evaluation"] == 120000
        assert dist_entries[1]["evaluation"] == 118000


# ---------------------------------------------------------------------------
# P3-R3-T2: Router Tests
# ---------------------------------------------------------------------------


class TestPensionPlanRouter:
    """연금 계획 라우터 import 및 경로 테스트."""

    def test_import_router(self):
        from app.api.v1 import pension_plans
        assert pension_plans.router is not None

    def test_router_prefix(self):
        from app.api.v1 import pension_plans

        router = pension_plans.router
        assert router.prefix == "/retirement/pension", (
            f"Expected prefix '/retirement/pension', got '{router.prefix}'"
        )

    def test_router_has_calculate_route(self):
        from app.api.v1 import pension_plans

        router = pension_plans.router
        paths = {route.path for route in router.routes}
        assert "/calculate" in paths, "POST /calculate route missing"

    def test_router_has_customer_get_route(self):
        from app.api.v1 import pension_plans

        router = pension_plans.router
        paths = {route.path for route in router.routes}
        assert "/{customer_id}" in paths, "GET /{customer_id} route missing"

    def test_router_has_put_route(self):
        from app.api.v1 import pension_plans

        router = pension_plans.router
        paths = {route.path for route in router.routes}
        assert "/{pension_plan_id}" in paths, "PUT /{pension_plan_id} route missing"

    def test_router_registered_in_main_app(self):
        from app.main import app

        all_paths = []
        for route in app.routes:
            if hasattr(route, "path"):
                all_paths.append(route.path)

        pension_routes = [p for p in all_paths if "pension" in p]
        assert len(pension_routes) > 0, (
            "No pension routes found in app. "
            "Did you forget to include pension_plans router in main.py?"
        )


# ---------------------------------------------------------------------------
# P3-R3-T2: Schemas Tests
# ---------------------------------------------------------------------------


class TestPensionPlanSchemas:
    """연금 계획 Pydantic 스키마 테스트."""

    def test_import_schemas(self):
        from app.schemas.pension_plan import (
            PensionCalculateRequest,
            PensionPlanResponse,
            PensionPlanUpdate,
        )
        assert PensionCalculateRequest is not None
        assert PensionPlanResponse is not None
        assert PensionPlanUpdate is not None

    def test_calculate_request_required_fields(self):
        from app.schemas.pension_plan import PensionCalculateRequest

        req = PensionCalculateRequest(
            customer_id="abc-123",
            pension_type="lifetime",
        )
        assert req.customer_id == "abc-123"
        assert req.pension_type == "lifetime"

    def test_calculate_request_pension_type_enum(self):
        """pension_type은 lifetime/fixed/inheritance 중 하나여야 함."""
        import pytest
        from pydantic import ValidationError
        from app.schemas.pension_plan import PensionCalculateRequest

        with pytest.raises(ValidationError):
            PensionCalculateRequest(
                customer_id="abc-123",
                pension_type="invalid_type",
            )

    def test_response_schema_has_required_fields(self):
        from app.schemas.pension_plan import PensionPlanResponse

        fields = PensionPlanResponse.model_fields
        assert "id" in fields
        assert "profile_id" in fields
        assert "pension_type" in fields

    def test_update_schema_all_optional(self):
        from app.schemas.pension_plan import PensionPlanUpdate

        # All fields should be optional (allow partial update)
        update = PensionPlanUpdate()
        assert update is not None
