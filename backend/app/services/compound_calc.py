"""복리 역산 계산 서비스.

공식:
  목표 은퇴자금 = 월 희망 수령액 × 12 × 은퇴기간(년)   ← 단순 합산, 물가상승 미반영
  필요 일시납 PV = FV / (1+r)^n
  필요 연간 적립 PMT = FV × r / ((1+r)^n - 1)

기본 수익률: 7% per year
"""
from __future__ import annotations


class CompoundCalcService:
    """복리 역산 계산 서비스 (정적 메서드 모음)."""

    DEFAULT_ANNUAL_RATE: float = 0.07

    # ------------------------------------------------------------------
    # 개별 계산 메서드
    # ------------------------------------------------------------------

    @staticmethod
    def calculate_target_total_fund(
        monthly_desired_amount: int,
        retirement_period_years: int,
    ) -> int:
        """목표 은퇴자금 = 월 희망 수령액 × 12 × 은퇴기간(년).

        물가 상승률 미반영 단순 계산.
        """
        return monthly_desired_amount * 12 * retirement_period_years

    @staticmethod
    def calculate_required_lump_sum(
        target_total_fund: int | float,
        years_to_retirement: int,
        annual_rate: float = 0.07,
    ) -> float:
        """필요 일시납(PV) 역산.

        PV = FV / (1+r)^n
        years_to_retirement=0 이면 현재 시점이므로 PV = FV.
        """
        if years_to_retirement == 0:
            return float(target_total_fund)
        return target_total_fund / ((1 + annual_rate) ** years_to_retirement)

    @staticmethod
    def calculate_required_annual_savings(
        target_total_fund: int | float,
        years_to_retirement: int,
        annual_rate: float = 0.07,
    ) -> float:
        """필요 연간 적립액(PMT) 역산.

        PMT = FV × r / ((1+r)^n - 1)
        years_to_retirement=0 이면 0 반환 (적립 기간 없음).
        """
        if years_to_retirement == 0:
            return 0.0
        fv_factor = (1 + annual_rate) ** years_to_retirement - 1
        if fv_factor == 0:
            return 0.0
        return target_total_fund * annual_rate / fv_factor

    # ------------------------------------------------------------------
    # 통합 계산 메서드
    # ------------------------------------------------------------------

    @classmethod
    def calculate_all(
        cls,
        monthly_desired_amount: int,
        retirement_period_years: int,
        years_to_retirement: int,
        annual_rate: float | None = None,
    ) -> dict:
        """모든 값을 한 번에 계산하여 dict로 반환.

        Returns:
            {
                "target_total_fund": int,
                "required_lump_sum": float,
                "required_annual_savings": float,
                "calculation_params": {
                    "monthly_desired_amount": int,
                    "retirement_period_years": int,
                    "years_to_retirement": int,
                    "annual_rate": float,
                },
            }
        """
        rate = annual_rate if annual_rate is not None else cls.DEFAULT_ANNUAL_RATE

        target_total_fund = cls.calculate_target_total_fund(
            monthly_desired_amount=monthly_desired_amount,
            retirement_period_years=retirement_period_years,
        )
        required_lump_sum = cls.calculate_required_lump_sum(
            target_total_fund=target_total_fund,
            years_to_retirement=years_to_retirement,
            annual_rate=rate,
        )
        required_annual_savings = cls.calculate_required_annual_savings(
            target_total_fund=target_total_fund,
            years_to_retirement=years_to_retirement,
            annual_rate=rate,
        )

        return {
            "target_total_fund": target_total_fund,
            "required_lump_sum": required_lump_sum,
            "required_annual_savings": required_annual_savings,
            "calculation_params": {
                "monthly_desired_amount": monthly_desired_amount,
                "retirement_period_years": retirement_period_years,
                "years_to_retirement": years_to_retirement,
                "annual_rate": rate,
            },
        }
