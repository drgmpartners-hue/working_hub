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
        assert result["lump_sum_amount"] == 5000
        assert result["annual_savings_amount"] == 1200
        assert result["total_payment"] == 6200

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
