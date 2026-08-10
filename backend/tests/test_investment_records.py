"""Tests for investment_records model, CRUD API, and annual flow calculation."""
import pytest
from decimal import Decimal


# ---------------------------------------------------------------------------
# P2-R4-T1: Model Tests
# ---------------------------------------------------------------------------

class TestInvestmentRecordModelImport:
    """Verify InvestmentRecord model can be imported and has correct schema."""

    def test_import_model(self):
        from app.models.investment_record import InvestmentRecord
        assert InvestmentRecord.__tablename__ == "investment_records"

    def test_model_columns_exist(self):
        from app.db.base import Base
        import app.models  # noqa: F401

        table = Base.metadata.tables["investment_records"]
        col_names = set(table.columns.keys())
        required = {
            "id",
            "profile_id",
            "wrap_account_id",
            "record_type",
            "product_name",
            "investment_amount",
            "evaluation_amount",
            "return_rate",
            "status",
            "start_date",
            "end_date",
            "predecessor_id",
            "successor_id",
            "memo",
            "created_at",
            "updated_at",
        }
        missing = required - col_names
        assert not missing, f"Missing columns: {missing}"

    def test_profile_id_fk_to_retirement_profiles(self):
        from app.db.base import Base
        import app.models  # noqa: F401

        table = Base.metadata.tables["investment_records"]
        fk_targets = {
            fk.column.table.name
            for col in table.columns.values()
            for fk in col.foreign_keys
        }
        assert "customer_retirement_profiles" in fk_targets

    def test_wrap_account_id_fk_to_wrap_accounts(self):
        from app.db.base import Base
        import app.models  # noqa: F401

        table = Base.metadata.tables["investment_records"]
        fk_targets = {
            fk.column.table.name
            for col in table.columns.values()
            for fk in col.foreign_keys
        }
        assert "wrap_accounts" in fk_targets

    def test_predecessor_successor_self_reference(self):
        from app.db.base import Base
        import app.models  # noqa: F401

        table = Base.metadata.tables["investment_records"]
        fk_targets_all = {
            fk.column.table.name
            for col in table.columns.values()
            for fk in col.foreign_keys
        }
        # predecessor_id / successor_id FK to same table
        assert "investment_records" in fk_targets_all

    def test_package_exports_model(self):
        import app.models as models
        assert hasattr(models, "InvestmentRecord"), (
            "app.models must export InvestmentRecord"
        )

    def test_investment_amount_bigint(self):
        from app.db.base import Base
        import app.models  # noqa: F401
        from sqlalchemy import BigInteger

        table = Base.metadata.tables["investment_records"]
        col = table.columns["investment_amount"]
        assert isinstance(col.type, BigInteger)

    def test_return_rate_decimal(self):
        from app.db.base import Base
        import app.models  # noqa: F401
        from sqlalchemy import Numeric

        table = Base.metadata.tables["investment_records"]
        col = table.columns["return_rate"]
        assert isinstance(col.type, Numeric)


# ---------------------------------------------------------------------------
# P2-R4-T2: Schema Tests
# ---------------------------------------------------------------------------

class TestInvestmentRecordSchemas:
    """Verify Pydantic schemas work correctly."""

    def test_import_schemas(self):
        from app.schemas.investment_record import (
            InvestmentRecordCreate,
            InvestmentRecordUpdate,
            InvestmentRecordResponse,
        )
        assert InvestmentRecordCreate is not None
        assert InvestmentRecordUpdate is not None
        assert InvestmentRecordResponse is not None

    def test_create_schema_valid(self):
        from app.schemas.investment_record import InvestmentRecordCreate
        from datetime import date
        import uuid

        data = InvestmentRecordCreate(
            profile_id=str(uuid.uuid4()),
            record_type="investment",
            investment_amount=5000,
            status="ing",
            start_date=date(2024, 1, 1),
        )
        assert data.record_type == "investment"
        assert data.investment_amount == 5000

    def test_create_schema_invalid_record_type(self):
        from app.schemas.investment_record import InvestmentRecordCreate
        from datetime import date
        from pydantic import ValidationError
        import uuid

        with pytest.raises(ValidationError):
            InvestmentRecordCreate(
                profile_id=str(uuid.uuid4()),
                record_type="invalid_type",
                investment_amount=5000,
                status="ing",
                start_date=date(2024, 1, 1),
            )

    def test_create_schema_invalid_status(self):
        from app.schemas.investment_record import InvestmentRecordCreate
        from datetime import date
        from pydantic import ValidationError
        import uuid

        with pytest.raises(ValidationError):
            InvestmentRecordCreate(
                profile_id=str(uuid.uuid4()),
                record_type="investment",
                investment_amount=5000,
                status="invalid_status",
                start_date=date(2024, 1, 1),
            )

    def test_update_schema_partial(self):
        from app.schemas.investment_record import InvestmentRecordUpdate

        data = InvestmentRecordUpdate(memo="Updated memo")
        assert data.memo == "Updated memo"
        assert data.status is None

    def test_response_schema_from_attributes(self):
        from app.schemas.investment_record import InvestmentRecordResponse
        config = InvestmentRecordResponse.model_config
        assert config.get("from_attributes") is True


# ---------------------------------------------------------------------------
# P2-R4-T2: Return Rate Calculation Tests
# ---------------------------------------------------------------------------

class TestReturnRateCalculation:
    """Test automatic return rate calculation logic."""

    def test_return_rate_positive(self):
        from app.services.annual_flow_calc import calculate_return_rate

        rate = calculate_return_rate(
            investment_amount=1000,
            evaluation_amount=1100,
        )
        assert rate == pytest.approx(10.0, abs=0.01)

    def test_return_rate_negative(self):
        from app.services.annual_flow_calc import calculate_return_rate

        rate = calculate_return_rate(
            investment_amount=1000,
            evaluation_amount=900,
        )
        assert rate == pytest.approx(-10.0, abs=0.01)

    def test_return_rate_zero_investment(self):
        from app.services.annual_flow_calc import calculate_return_rate

        rate = calculate_return_rate(
            investment_amount=0,
            evaluation_amount=100,
        )
        assert rate is None

    def test_return_rate_none_evaluation(self):
        from app.services.annual_flow_calc import calculate_return_rate

        rate = calculate_return_rate(
            investment_amount=1000,
            evaluation_amount=None,
        )
        assert rate is None


# ---------------------------------------------------------------------------
# P2-R4-T3: Annual Flow Calculation Service Tests
# ---------------------------------------------------------------------------

class TestAnnualFlowCalcService:
    """Test annual investment flow calculation logic."""

    def test_import_service(self):
        from app.services.annual_flow_calc import calculate_annual_flow
        assert calculate_annual_flow is not None

    def test_annual_flow_basic(self):
        from app.services.annual_flow_calc import calculate_annual_flow
        from datetime import date

        records = [
            {
                "record_type": "investment",
                "investment_amount": 5000,
                "evaluation_amount": None,
                "status": "ing",
                "start_date": date(2024, 3, 1),
                "end_date": None,
            },
            {
                "record_type": "additional_savings",
                "investment_amount": 1200,
                "evaluation_amount": None,
                "status": "ing",
                "start_date": date(2024, 6, 1),
                "end_date": None,
            },
        ]
        result = calculate_annual_flow(records=records, year=2024)
        # 새 계산 방식: 일시납/적립은 예수금 거래 기반으로 별도 집계 → 여기선 0
        assert result["lump_sum_amount"] == 0
        assert result["annual_savings_amount"] == 0
        # 총투자금액·연간평가금액은 '당해 종결분'만 집계한다.
        # 두 건 모두 미종결이므로 0 (운용중 자산은 순자산이 담당)
        assert result["total_payment"] == 0
        assert result["annual_evaluation_amount"] == 0
        assert result["annual_total_profit"] == 0
        assert result["annual_return_rate"] is None

    def test_annual_flow_with_exit(self):
        from app.services.annual_flow_calc import calculate_annual_flow
        from datetime import date

        records = [
            {
                "record_type": "investment",
                "investment_amount": 3000,
                "evaluation_amount": 3300,
                "status": "exit",
                "start_date": date(2024, 1, 1),
                "end_date": date(2024, 12, 31),
            },
        ]
        result = calculate_annual_flow(records=records, year=2024)
        assert result["annual_total_profit"] == 300  # 3300 - 3000

    def test_annual_flow_multiyear_counted_once_at_exit_year(self):
        """해를 걸친 투자는 종결된 해에만 집계된다(직전 연도에는 미포함).

        2025.06 투자 → 2026.03 종결 건이 두 해 모두 계상되면 금액이 부풀려진다.
        """
        from app.services.annual_flow_calc import calculate_annual_flow
        from datetime import date

        records = [
            {
                "record_type": "investment",
                "investment_amount": 30_000_000,
                "evaluation_amount": 31_200_000,
                "status": "exit",
                "start_date": date(2025, 6, 10),
                "end_date": date(2026, 3, 20),
            },
        ]

        # 운용 중이던 해 — 목록에는 보이지만 집계에는 들어가지 않는다
        y2025 = calculate_annual_flow(records=records, year=2025)
        assert y2025["total_payment"] == 0
        assert y2025["annual_evaluation_amount"] == 0
        assert y2025["annual_total_profit"] == 0

        # 종결된 해 — 원금과 회수금액이 한 번만 집계된다
        y2026 = calculate_annual_flow(records=records, year=2026)
        assert y2026["total_payment"] == 30_000_000
        assert y2026["annual_evaluation_amount"] == 31_200_000
        assert y2026["annual_total_profit"] == 1_200_000
        assert y2026["annual_return_rate"] == 4.0

    def test_annual_flow_interim_eval_not_double_counted(self):
        """중간평가를 입력해도 수익이 두 해에 걸쳐 이중계상되지 않는다."""
        from app.services.annual_flow_calc import calculate_annual_flow
        from datetime import date

        records = [
            {
                "record_type": "investment",
                "investment_amount": 30_000_000,
                "evaluation_amount": 31_200_000,
                "interim_evaluations": {"2025": 31_000_000},
                "status": "exit",
                "start_date": date(2025, 6, 10),
                "end_date": date(2026, 3, 20),
            },
        ]
        # 중간평가가 있어도 미종결 해에는 수익을 인식하지 않는다
        assert calculate_annual_flow(records=records, year=2025)["annual_total_profit"] == 0
        # 총수익은 종결 해에 한 번만 (1,200,000). 두 해 합쳐도 2,200,000 이 되지 않는다
        assert calculate_annual_flow(records=records, year=2026)["annual_total_profit"] == 1_200_000

    def test_annual_flow_same_year_turnover_counted_separately(self):
        """같은 해 엑싯 후 재투자한 '회전'은 서로 다른 건이므로 각각 집계한다."""
        from app.services.annual_flow_calc import calculate_annual_flow
        from datetime import date

        records = [
            {
                "record_type": "investment", "investment_amount": 5000,
                "evaluation_amount": 5500, "status": "exit",
                "start_date": date(2024, 1, 10), "end_date": date(2024, 5, 10),
            },
            {
                "record_type": "investment", "investment_amount": 5500,
                "evaluation_amount": 6000, "status": "exit",
                "start_date": date(2024, 5, 20), "end_date": date(2024, 11, 30),
            },
        ]
        result = calculate_annual_flow(records=records, year=2024)
        assert result["total_payment"] == 10_500          # 회전 총액
        assert result["annual_evaluation_amount"] == 11_500
        assert result["annual_total_profit"] == 1000      # 500 + 500

    def test_annual_flow_withdrawal(self):
        from app.services.annual_flow_calc import calculate_annual_flow
        from datetime import date

        records = [
            {
                "record_type": "withdrawal",
                "investment_amount": 500,
                "evaluation_amount": None,
                "status": "exit",
                "start_date": date(2024, 4, 1),
                "end_date": date(2024, 4, 1),
            },
        ]
        result = calculate_annual_flow(records=records, year=2024)
        assert result["withdrawal_amount"] == 500

    def test_annual_flow_empty_records(self):
        from app.services.annual_flow_calc import calculate_annual_flow

        result = calculate_annual_flow(records=[], year=2024)
        assert result["lump_sum_amount"] == 0
        assert result["annual_savings_amount"] == 0
        assert result["total_payment"] == 0
        assert result["annual_total_profit"] == 0
        assert result["withdrawal_amount"] == 0
        assert result["annual_return_rate"] is None

    def test_annual_flow_response_keys(self):
        from app.services.annual_flow_calc import calculate_annual_flow

        result = calculate_annual_flow(records=[], year=2024)
        required_keys = {
            "year",
            "lump_sum_amount",
            "annual_savings_amount",
            "total_payment",
            "annual_total_profit",
            "annual_evaluation_amount",
            "annual_return_rate",
            "withdrawal_amount",
        }
        assert required_keys.issubset(set(result.keys()))
