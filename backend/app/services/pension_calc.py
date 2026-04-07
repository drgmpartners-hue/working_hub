"""Pension calculation service.

Three pension distribution methods
-----------------------------------
1. 종신형 (lifetime):
   monthly_amount = retirement_fund / (life_expectancy_years * 12)
   life_expectancy_years = 100 - retirement_age

2. 확정형 (fixed):
   monthly_amount = retirement_fund / (fixed_period_years * 12)
   fixed_period_years = 20

3. 상속형 (inheritance):
   monthly_amount = retirement_fund * annual_rate / 12
   annual_rate = 3.5%  (principal preserved)

Combined graph data
-------------------
- accumulation phase: retirement_plans.yearly_projections (evaluation field)
- distribution phase: yearly balance from distribution_plan (balance field)
- combined_graph_data: [{age, evaluation, phase: 'accumulation'|'distribution'}]
"""
from __future__ import annotations

from typing import Literal


LIFETIME_PENSION_FACTOR = 1.0
FIXED_PERIOD_YEARS = 20
INHERITANCE_ANNUAL_RATE = 3.5  # percent
MAX_AGE = 100


class PensionCalcService:
    """Pure calculation service — no DB dependency."""

    # ------------------------------------------------------------------
    # 종신형 (lifetime)
    # ------------------------------------------------------------------

    @classmethod
    def calculate_lifetime(
        cls,
        retirement_fund: float,
        retirement_age: int,
    ) -> dict:
        """종신형 연금 계산.

        Parameters
        ----------
        retirement_fund:
            은퇴자금 (만원 단위).
        retirement_age:
            은퇴 나이.

        Returns
        -------
        dict with keys:
            pension_type, monthly_amount, life_expectancy_years,
            distribution_plan, accumulation_summary
        """
        life_expectancy_years = MAX_AGE - retirement_age
        if life_expectancy_years <= 0:
            monthly_amount = 0.0
        else:
            monthly_amount = retirement_fund / (life_expectancy_years * 12) * LIFETIME_PENSION_FACTOR

        annual_withdrawal = monthly_amount * 12
        distribution_plan = cls._build_distribution_plan_decrement(
            retirement_fund=retirement_fund,
            retirement_age=retirement_age,
            annual_withdrawal=annual_withdrawal,
            end_age=MAX_AGE,
        )

        return {
            "pension_type": "lifetime",
            "monthly_amount": round(monthly_amount, 4),
            "life_expectancy_years": life_expectancy_years,
            "distribution_plan": distribution_plan,
            "accumulation_summary": None,
        }

    # ------------------------------------------------------------------
    # 확정형 (fixed)
    # ------------------------------------------------------------------

    @classmethod
    def calculate_fixed(
        cls,
        retirement_fund: float,
        retirement_age: int,
        fixed_period_years: int = FIXED_PERIOD_YEARS,
    ) -> dict:
        """확정형 연금 계산.

        Parameters
        ----------
        retirement_fund:
            은퇴자금 (만원 단위).
        retirement_age:
            은퇴 나이.
        fixed_period_years:
            확정 지급 기간 (기본 20년).
        """
        if fixed_period_years <= 0:
            monthly_amount = 0.0
        else:
            monthly_amount = retirement_fund / (fixed_period_years * 12)

        annual_withdrawal = monthly_amount * 12
        end_age = retirement_age + fixed_period_years - 1
        distribution_plan = cls._build_distribution_plan_decrement(
            retirement_fund=retirement_fund,
            retirement_age=retirement_age,
            annual_withdrawal=annual_withdrawal,
            end_age=end_age,
        )

        return {
            "pension_type": "fixed",
            "monthly_amount": round(monthly_amount, 4),
            "fixed_period_years": fixed_period_years,
            "distribution_plan": distribution_plan,
            "accumulation_summary": None,
        }

    # ------------------------------------------------------------------
    # 상속형 (inheritance)
    # ------------------------------------------------------------------

    @classmethod
    def calculate_inheritance(
        cls,
        retirement_fund: float,
        retirement_age: int,
        annual_rate: float = INHERITANCE_ANNUAL_RATE,
    ) -> dict:
        """상속형 연금 계산 (원금 보존).

        Parameters
        ----------
        retirement_fund:
            은퇴자금 (만원 단위).
        retirement_age:
            은퇴 나이.
        annual_rate:
            연이자율 (%, 기본 3.5).
        """
        monthly_amount = retirement_fund * (annual_rate / 100) / 12
        end_age = MAX_AGE

        distribution_plan = []
        for age in range(retirement_age, end_age + 1):
            distribution_plan.append({
                "age": age,
                "monthly_amount": round(monthly_amount, 4),
                "annual_withdrawal": round(monthly_amount * 12, 4),
                "balance": round(retirement_fund, 4),  # 원금 보존
            })

        return {
            "pension_type": "inheritance",
            "monthly_amount": round(monthly_amount, 4),
            "annual_rate": annual_rate,
            "distribution_plan": distribution_plan,
            "accumulation_summary": None,
        }

    # ------------------------------------------------------------------
    # 통합 그래프 데이터
    # ------------------------------------------------------------------

    @classmethod
    def build_combined_graph(
        cls,
        accumulation_projections: list[dict],
        distribution_plan: list[dict],
        retirement_age: int,
    ) -> list[dict]:
        """모으는 기간 + 쓰는 기간 통합 그래프 데이터 생성.

        Parameters
        ----------
        accumulation_projections:
            retirement_plans.yearly_projections 형태의 배열.
            각 항목: {age, evaluation, ...}
        distribution_plan:
            연금 지급 계획 배열.
            각 항목: {age, balance, ...}
        retirement_age:
            은퇴 나이 (accumulation/distribution 구분 기준).

        Returns
        -------
        List of {age, evaluation, phase} dicts.
        """
        combined: list[dict] = []

        # 모으는 기간 (accumulation phase)
        for entry in accumulation_projections:
            age = entry.get("age", 0)
            evaluation = entry.get("evaluation", 0)
            combined.append({
                "age": age,
                "evaluation": evaluation,
                "phase": "accumulation",
            })

        # 쓰는 기간 (distribution phase)
        for entry in distribution_plan:
            age = entry.get("age", 0)
            balance = entry.get("balance", 0)
            combined.append({
                "age": age,
                "evaluation": balance,
                "phase": "distribution",
            })

        return combined

    # ------------------------------------------------------------------
    # 통합 계산 (pension_type에 따라 분기)
    # ------------------------------------------------------------------

    @classmethod
    def calculate(
        cls,
        retirement_fund: float,
        retirement_age: int,
        pension_type: Literal["lifetime", "fixed", "inheritance"],
        accumulation_projections: list[dict] | None = None,
    ) -> dict:
        """pension_type에 따라 연금 계산 + 통합 그래프 데이터 생성.

        Parameters
        ----------
        retirement_fund:
            은퇴자금 (만원 단위).
        retirement_age:
            은퇴 나이.
        pension_type:
            연금 지급 유형.
        accumulation_projections:
            retirement_plans.yearly_projections 배열 (통합 그래프용).

        Returns
        -------
        dict with pension result + combined_graph_data.
        """
        if pension_type == "lifetime":
            result = cls.calculate_lifetime(retirement_fund, retirement_age)
        elif pension_type == "fixed":
            result = cls.calculate_fixed(retirement_fund, retirement_age)
        elif pension_type == "inheritance":
            result = cls.calculate_inheritance(retirement_fund, retirement_age)
        else:
            raise ValueError(f"Unknown pension_type: {pension_type}")

        # 통합 그래프 데이터 생성
        if accumulation_projections:
            combined_graph_data = cls.build_combined_graph(
                accumulation_projections=accumulation_projections,
                distribution_plan=result["distribution_plan"],
                retirement_age=retirement_age,
            )
        else:
            combined_graph_data = cls.build_combined_graph(
                accumulation_projections=[],
                distribution_plan=result["distribution_plan"],
                retirement_age=retirement_age,
            )

        result["combined_graph_data"] = combined_graph_data
        return result

    # ------------------------------------------------------------------
    # 내부 헬퍼
    # ------------------------------------------------------------------

    @classmethod
    def _build_distribution_plan_decrement(
        cls,
        retirement_fund: float,
        retirement_age: int,
        annual_withdrawal: float,
        end_age: int,
    ) -> list[dict]:
        """매년 annual_withdrawal씩 감소하는 잔액 배열 생성 (floor at 0)."""
        plan = []
        balance = retirement_fund

        for age in range(retirement_age, end_age + 1):
            monthly_amount = annual_withdrawal / 12
            plan.append({
                "age": age,
                "monthly_amount": round(monthly_amount, 4),
                "annual_withdrawal": round(annual_withdrawal, 4),
                "balance": round(max(balance, 0.0), 4),
            })
            balance = max(balance - annual_withdrawal, 0.0)

        return plan
