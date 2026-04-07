"""Unit tests for retirement simulation service.

Tests the pure calculation logic without any DB or HTTP dependencies.
"""
from __future__ import annotations

import pytest
from app.services.retirement_simulation import RetirementSimulationService


class TestRetirementSimulationService:
    """Unit tests for RetirementSimulationService.calculate."""

    def test_returns_projections_list(self):
        """Should return a list of yearly projection dicts."""
        result = RetirementSimulationService.calculate(
            current_age=45,
            annual_return_rate=7.0,
            lump_sum_amount=50000,
            annual_savings=12000,
            saving_period_years=15,
            target_pension_amount=3000,
        )
        assert isinstance(result, list)
        assert len(result) > 0

    def test_projections_cover_100_years_old(self):
        """Projections should cover from current_age to 100."""
        result = RetirementSimulationService.calculate(
            current_age=45,
            annual_return_rate=7.0,
            lump_sum_amount=50000,
            annual_savings=12000,
            saving_period_years=15,
            target_pension_amount=3000,
        )
        # 45 ~ 100 inclusive = 56 entries
        assert len(result) == 56
        assert result[0]["age"] == 45
        assert result[-1]["age"] == 100

    def test_first_entry_fields(self):
        """Each projection entry should have required fields."""
        result = RetirementSimulationService.calculate(
            current_age=45,
            annual_return_rate=7.0,
            lump_sum_amount=50000,
            annual_savings=12000,
            saving_period_years=15,
            target_pension_amount=3000,
        )
        entry = result[0]
        assert "year" in entry
        assert "year_num" in entry
        assert "age" in entry
        assert "lump_sum" in entry
        assert "annual_savings" in entry
        assert "total_contribution" in entry
        assert "annual_return" in entry
        assert "evaluation" in entry

    def test_year_num_increments(self):
        """year_num should start at 1 and increment by 1 each year."""
        result = RetirementSimulationService.calculate(
            current_age=50,
            annual_return_rate=5.0,
            lump_sum_amount=0,
            annual_savings=10000,
            saving_period_years=10,
            target_pension_amount=1000,
        )
        for i, entry in enumerate(result):
            assert entry["year_num"] == i + 1

    def test_first_year_lump_sum_included(self):
        """First year evaluation should include lump_sum_amount."""
        result = RetirementSimulationService.calculate(
            current_age=45,
            annual_return_rate=10.0,
            lump_sum_amount=100000,
            annual_savings=0,
            saving_period_years=1,
            target_pension_amount=0,
        )
        # first year: 0 * 1.1 + 100000 = 100000 (lump_sum added end of year)
        # Actually: prev=0, prev*(1+r) + lump_sum(year1) + annual_savings
        # = 0*1.1 + 100000 + 0 = 100000
        # But spec says: evaluation = 전년도평가 × (1 + 연수익률) + 연적립금액, 첫해는 + 일시납금액
        # = 0 * 1.1 + 0 + 100000 = 100000
        # Then evaluation applies return on top? Let me re-read spec:
        # "평가금액 = 전년도평가 × (1 + 연수익률) + 연적립금액, 첫해는 + 일시납금액"
        # So first year: 0*(1.1) + 0 + 100000 = 100000? or
        # (0 + 100000) * 1.1 = 110000?
        # Spec formula: evaluation = prev * (1+r) + annual_savings [+ lump_sum if year 1]
        # first year: 0 * 1.1 + 0 + 100000 = 100000
        # But test in API test says 110000... Let me check the API test:
        # API test: annual_return_rate=10%, lump_sum=100000, annual_savings=0, saving_period=1
        # expected: 110000
        # That means: (0 + 100000) * 1.1 = 110000
        # => lump_sum is added BEFORE applying return
        first = result[0]
        assert first["evaluation"] == pytest.approx(110000, rel=1e-3)

    def test_saving_period_applies_annual_savings(self):
        """During saving period, annual_savings should be added."""
        result = RetirementSimulationService.calculate(
            current_age=45,
            annual_return_rate=0.0,
            lump_sum_amount=0,
            annual_savings=12000,
            saving_period_years=5,
            target_pension_amount=0,
        )
        # With 0% return: year 1 = 12000, year 2 = 24000, ...
        assert result[0]["evaluation"] == pytest.approx(12000, rel=1e-3)
        assert result[1]["evaluation"] == pytest.approx(24000, rel=1e-3)
        assert result[4]["evaluation"] == pytest.approx(60000, rel=1e-3)

    def test_after_saving_period_no_annual_savings(self):
        """After saving period, annual_savings should not be added."""
        result = RetirementSimulationService.calculate(
            current_age=45,
            annual_return_rate=0.0,
            lump_sum_amount=0,
            annual_savings=12000,
            saving_period_years=1,
            target_pension_amount=0,
        )
        # year 1: 12000, year 2+: no new savings, 0% return -> stays 12000
        assert result[0]["evaluation"] == pytest.approx(12000, rel=1e-3)
        assert result[1]["evaluation"] == pytest.approx(12000, rel=1e-3)

    def test_pension_withdrawal_after_saving_period(self):
        """After saving period, target_pension_amount*12 should be withdrawn."""
        result = RetirementSimulationService.calculate(
            current_age=45,
            annual_return_rate=0.0,
            lump_sum_amount=0,
            annual_savings=12000,
            saving_period_years=1,
            target_pension_amount=500,  # 500만/월 * 12 = 6000만/년
        )
        # year 1 (age 45): 12000 (saving period)
        # year 2 (age 46): 12000 * 1.0 - 500*12 = 12000 - 6000 = 6000
        assert result[1]["evaluation"] == pytest.approx(6000, rel=1e-3)

    def test_evaluation_does_not_go_below_zero(self):
        """Evaluation should not go negative (floor at 0)."""
        result = RetirementSimulationService.calculate(
            current_age=45,
            annual_return_rate=0.0,
            lump_sum_amount=0,
            annual_savings=1000,
            saving_period_years=1,
            target_pension_amount=5000,  # 월 5000 = 연 60000 (훨씬 큼)
        )
        # After saving period, withdrawal exceeds balance -> floor at 0
        for entry in result[1:]:
            assert entry["evaluation"] >= 0

    def test_projection_ages_sequential(self):
        """Ages in projections should be sequential starting from current_age."""
        result = RetirementSimulationService.calculate(
            current_age=40,
            annual_return_rate=5.0,
            lump_sum_amount=0,
            annual_savings=10000,
            saving_period_years=20,
            target_pension_amount=2000,
        )
        for i, entry in enumerate(result):
            assert entry["age"] == 40 + i

    def test_with_zero_return_rate(self):
        """Should work correctly with 0% annual return rate."""
        result = RetirementSimulationService.calculate(
            current_age=50,
            annual_return_rate=0.0,
            lump_sum_amount=10000,
            annual_savings=5000,
            saving_period_years=10,
            target_pension_amount=1000,
        )
        assert result is not None
        assert len(result) == 51  # 50 to 100 inclusive

    def test_lump_sum_only_first_year(self):
        """Lump sum should only appear in first year projections."""
        result = RetirementSimulationService.calculate(
            current_age=45,
            annual_return_rate=0.0,
            lump_sum_amount=50000,
            annual_savings=0,
            saving_period_years=5,
            target_pension_amount=0,
        )
        # First year should have lump_sum = 50000
        assert result[0]["lump_sum"] == 50000
        # Subsequent years should have lump_sum = 0
        for entry in result[1:]:
            assert entry["lump_sum"] == 0
