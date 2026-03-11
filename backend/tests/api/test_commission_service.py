"""Unit tests for commission_service calculation logic.

These tests exercise the pure calculation helpers without touching the database.
"""
from __future__ import annotations

import pytest


class TestDrGmCalculation:
    """Tests for dr_gm calculation logic."""

    def test_dr_gm_default_rate(self):
        from app.services.commission_service import _compute_dr_gm

        emp = {"name": "Alice", "base_salary": 3000000}
        result = _compute_dr_gm(emp)
        # default rate 0.03
        assert result["commission_amount"] == pytest.approx(90000.0)
        assert result["commission_rate_used"] == pytest.approx(0.03)
        assert result["calc_basis"] == "base_salary"

    def test_dr_gm_custom_rate(self):
        from app.services.commission_service import _compute_dr_gm

        emp = {"name": "Bob", "base_salary": 2000000, "commission_rate": 0.05}
        result = _compute_dr_gm(emp)
        assert result["commission_amount"] == pytest.approx(100000.0)

    def test_dr_gm_zero_salary(self):
        from app.services.commission_service import _compute_dr_gm

        emp = {"name": "Zero", "base_salary": 0}
        result = _compute_dr_gm(emp)
        assert result["commission_amount"] == 0.0

    def test_dr_gm_preserves_extra_fields(self):
        from app.services.commission_service import _compute_dr_gm

        emp = {"name": "Alice", "base_salary": 1000000, "department": "Sales"}
        result = _compute_dr_gm(emp)
        assert result["department"] == "Sales"


class TestSecuritiesCalculation:
    """Tests for securities calculation logic."""

    def test_securities_default_rate(self):
        from app.services.commission_service import _compute_securities

        emp = {"name": "Charlie", "sales_amount": 10000000}
        result = _compute_securities(emp)
        # default rate 0.05
        assert result["commission_amount"] == pytest.approx(500000.0)
        assert result["commission_rate_used"] == pytest.approx(0.05)
        assert result["calc_basis"] == "sales_amount"

    def test_securities_custom_rate(self):
        from app.services.commission_service import _compute_securities

        emp = {"name": "Dave", "sales_amount": 5000000, "commission_rate": 0.02}
        result = _compute_securities(emp)
        assert result["commission_amount"] == pytest.approx(100000.0)

    def test_securities_zero_sales(self):
        from app.services.commission_service import _compute_securities

        emp = {"name": "Zero", "sales_amount": 0}
        result = _compute_securities(emp)
        assert result["commission_amount"] == 0.0


class TestRunCalculation:
    """Tests for the top-level _run_calculation dispatcher."""

    def test_run_dr_gm_multiple_employees(self):
        from app.services.commission_service import _run_calculation

        input_data = {
            "employees": [
                {"name": "Alice", "base_salary": 1000000, "commission_rate": 0.10},
                {"name": "Bob", "base_salary": 2000000, "commission_rate": 0.10},
            ]
        }
        per_emp, summary = _run_calculation("dr_gm", input_data)
        assert len(per_emp) == 2
        assert summary["total_employees"] == 2
        assert summary["total_commission"] == pytest.approx(300000.0)

    def test_run_securities_multiple_employees(self):
        from app.services.commission_service import _run_calculation

        input_data = {
            "employees": [
                {"name": "C", "sales_amount": 1000000, "commission_rate": 0.01},
                {"name": "D", "sales_amount": 2000000, "commission_rate": 0.01},
            ]
        }
        per_emp, summary = _run_calculation("securities", input_data)
        assert summary["total_commission"] == pytest.approx(30000.0)

    def test_run_unknown_type_raises(self):
        from app.services.commission_service import _run_calculation

        with pytest.raises(ValueError, match="Unknown calc_type"):
            _run_calculation("unknown", {})

    def test_run_empty_employees(self):
        from app.services.commission_service import _run_calculation

        per_emp, summary = _run_calculation("dr_gm", {"employees": []})
        assert per_emp == []
        assert summary["total_employees"] == 0
        assert summary["total_commission"] == 0

    def test_run_missing_employees_key(self):
        from app.services.commission_service import _run_calculation

        # No "employees" key — treated as empty list
        per_emp, summary = _run_calculation("dr_gm", {})
        assert per_emp == []
        assert summary["total_employees"] == 0
