"""Tests for interactive_calculations model, service, and API endpoints.

P3-R1-T1: InteractiveCalculation DB model tests
P3-R1-T2: Interactive calc service + API tests
"""
from __future__ import annotations

import pytest
from datetime import date


# ---------------------------------------------------------------------------
# P3-R1-T1: Model Tests
# ---------------------------------------------------------------------------

class TestInteractiveCalculationModelImport:
    """Verify InteractiveCalculation model can be imported and has correct schema."""

    def test_import_model(self):
        from app.models.interactive_calculation import InteractiveCalculation
        assert InteractiveCalculation.__tablename__ == "interactive_calculations"

    def test_model_columns_exist(self):
        from app.db.base import Base
        import app.models  # noqa: F401

        table = Base.metadata.tables["interactive_calculations"]
        col_names = set(table.columns.keys())
        required = {
            "id",
            "profile_id",
            "plan_year",
            "actual_data",
            "projected_data",
            "deviation_rate",
            "ai_guide_result",
            "created_at",
            "updated_at",
        }
        missing = required - col_names
        assert not missing, f"Missing columns: {missing}"

    def test_profile_id_fk_to_retirement_profiles(self):
        from app.db.base import Base
        import app.models  # noqa: F401

        table = Base.metadata.tables["interactive_calculations"]
        fk_targets = {
            fk.column.table.name
            for col in table.columns.values()
            for fk in col.foreign_keys
        }
        assert "customer_retirement_profiles" in fk_targets

    def test_model_in_init(self):
        from app.models import InteractiveCalculation
        assert InteractiveCalculation is not None

    def test_actual_data_is_jsonb(self):
        from app.db.base import Base
        import app.models  # noqa: F401
        from sqlalchemy.dialects.postgresql import JSONB

        table = Base.metadata.tables["interactive_calculations"]
        col = table.columns["actual_data"]
        assert isinstance(col.type, JSONB)

    def test_projected_data_is_jsonb(self):
        from app.db.base import Base
        import app.models  # noqa: F401
        from sqlalchemy.dialects.postgresql import JSONB

        table = Base.metadata.tables["interactive_calculations"]
        col = table.columns["projected_data"]
        assert isinstance(col.type, JSONB)

    def test_plan_year_not_nullable(self):
        from app.db.base import Base
        import app.models  # noqa: F401

        table = Base.metadata.tables["interactive_calculations"]
        col = table.columns["plan_year"]
        assert not col.nullable


# ---------------------------------------------------------------------------
# P3-R1-T2: Service Tests
# ---------------------------------------------------------------------------

class TestInteractiveCalcService:
    """Unit tests for InteractiveCalcService logic (no DB dependency)."""

    def test_import_service(self):
        from app.services.interactive_calc import InteractiveCalcService
        assert InteractiveCalcService is not None

    def test_calculate_deviation_rate_positive(self):
        """이격률 = (실제 - 계획) / 계획 × 100"""
        from app.services.interactive_calc import InteractiveCalcService

        deviation = InteractiveCalcService.compute_deviation_rate(
            planned=1000.0,
            actual=1100.0,
        )
        assert deviation == pytest.approx(10.0, rel=1e-3)

    def test_calculate_deviation_rate_negative(self):
        from app.services.interactive_calc import InteractiveCalcService

        deviation = InteractiveCalcService.compute_deviation_rate(
            planned=1000.0,
            actual=900.0,
        )
        assert deviation == pytest.approx(-10.0, rel=1e-3)

    def test_calculate_deviation_rate_zero_planned(self):
        """계획이 0이면 None 반환."""
        from app.services.interactive_calc import InteractiveCalcService

        deviation = InteractiveCalcService.compute_deviation_rate(
            planned=0.0,
            actual=500.0,
        )
        assert deviation is None

    def test_build_actual_data_empty_records(self):
        """투자 기록이 없으면 빈 actual_data 반환."""
        from app.services.interactive_calc import InteractiveCalcService

        actual = InteractiveCalcService.build_actual_data(
            records=[],
            plan_year=2025,
            yearly_projections=[
                {"year": 2025, "year_num": 1, "age": 45, "evaluation": 1000.0},
                {"year": 2026, "year_num": 2, "age": 46, "evaluation": 1100.0},
            ],
        )
        assert isinstance(actual, list)

    def test_build_actual_data_with_records(self):
        """투자 기록이 있으면 actual_data에 연도별 데이터 포함."""
        from app.services.interactive_calc import InteractiveCalcService

        records = [
            {
                "record_type": "investment",
                "investment_amount": 10000,
                "evaluation_amount": 11000,
                "status": "exit",
                "start_date": date(2025, 1, 15),
            }
        ]
        actual = InteractiveCalcService.build_actual_data(
            records=records,
            plan_year=2025,
            yearly_projections=[
                {"year": 2025, "year_num": 1, "age": 45, "evaluation": 9000.0},
            ],
        )
        assert len(actual) >= 1
        entry = next((e for e in actual if e["year"] == 2025), None)
        assert entry is not None
        assert "actual_evaluation" in entry
        assert "planned_evaluation" in entry

    def test_build_projected_data_extends_from_last_actual(self):
        """수정 예측: 마지막 실제 평가액 기준으로 남은 기간 시뮬레이션."""
        from app.services.interactive_calc import InteractiveCalcService

        last_actual_evaluation = 12000.0
        annual_return_rate = 7.0
        target_pension_amount = 0.0
        remaining_projections = [
            {"year": 2026, "year_num": 2, "age": 46, "evaluation": 11500.0},
            {"year": 2027, "year_num": 3, "age": 47, "evaluation": 12300.0},
        ]

        projected = InteractiveCalcService.build_projected_data(
            last_actual_evaluation=last_actual_evaluation,
            annual_return_rate=annual_return_rate,
            target_pension_amount=target_pension_amount,
            remaining_projections=remaining_projections,
        )
        assert isinstance(projected, list)
        assert len(projected) == len(remaining_projections)
        # 첫 projected는 last_actual을 기반으로 계산: 12000 * 1.07 = 12840
        assert projected[0]["evaluation"] == pytest.approx(12840.0, rel=1e-3)

    def test_run_returns_result_dict(self):
        """run() 메서드는 actual_data, projected_data, deviation_rate를 포함한 dict 반환."""
        from app.services.interactive_calc import InteractiveCalcService

        records = [
            {
                "record_type": "investment",
                "investment_amount": 10000,
                "evaluation_amount": 11000,
                "status": "exit",
                "start_date": date(2025, 1, 15),
            }
        ]
        yearly_projections = [
            {"year": 2025, "year_num": 1, "age": 45, "evaluation": 9000.0,
             "lump_sum": 0, "annual_savings": 0, "total_contribution": 0, "annual_return": 0},
            {"year": 2026, "year_num": 2, "age": 46, "evaluation": 9630.0,
             "lump_sum": 0, "annual_savings": 0, "total_contribution": 0, "annual_return": 0},
            {"year": 2027, "year_num": 3, "age": 47, "evaluation": 10304.0,
             "lump_sum": 0, "annual_savings": 0, "total_contribution": 0, "annual_return": 0},
        ]

        result = InteractiveCalcService.run(
            records=records,
            plan_year=2025,
            yearly_projections=yearly_projections,
            annual_return_rate=7.0,
            target_pension_amount=0.0,
        )
        assert "actual_data" in result
        assert "projected_data" in result
        assert "deviation_rate" in result
        assert isinstance(result["actual_data"], list)
        assert isinstance(result["projected_data"], list)


# ---------------------------------------------------------------------------
# P3-R1-T2: Schema Tests
# ---------------------------------------------------------------------------

class TestInteractiveCalcSchemas:
    """Verify Pydantic schemas for interactive calculations."""

    def test_import_schemas(self):
        from app.schemas.interactive_calculation import (
            InteractiveCalcRequest,
            InteractiveCalcResponse,
        )
        assert InteractiveCalcRequest is not None
        assert InteractiveCalcResponse is not None

    def test_request_schema_fields(self):
        from app.schemas.interactive_calculation import InteractiveCalcRequest

        req = InteractiveCalcRequest(customer_id="test-uuid", plan_year=2025)
        assert req.customer_id == "test-uuid"
        assert req.plan_year == 2025

    def test_response_schema_fields(self):
        from app.schemas.interactive_calculation import InteractiveCalcResponse

        resp = InteractiveCalcResponse(
            id=1,
            profile_id="test-uuid",
            plan_year=2025,
            actual_data=[],
            projected_data=[],
            deviation_rate=5.0,
            ai_guide_result=None,
        )
        assert resp.id == 1
        assert resp.plan_year == 2025
        assert resp.deviation_rate == 5.0


# ---------------------------------------------------------------------------
# P3-R1-T2: Router Tests
# ---------------------------------------------------------------------------

class TestInteractiveCalcRouterImport:
    """Verify router can be imported."""

    def test_import_router(self):
        from app.api.v1.interactive_calculations import router
        assert router is not None

    def test_router_has_routes(self):
        from app.api.v1.interactive_calculations import router

        route_paths = [route.path for route in router.routes]
        # POST /simulation/interactive
        assert any("interactive" in p for p in route_paths)

    def test_router_registered_in_main(self):
        """main.py에 라우터가 등록되어 있는지 확인."""
        from app.main import app

        all_routes = [route.path for route in app.routes]
        # /api/v1/retirement/simulation/interactive 또는 /api/v1/retirement/interactive/{customer_id}
        assert any("interactive" in path for path in all_routes)
