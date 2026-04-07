"""Retirement simulation service.

Computes yearly projected fund evaluation from current age to age 100.

Calculation logic
-----------------
Saving period (year_num <= saving_period_years):
    If year_num == 1:
        evaluation = (lump_sum_amount + annual_savings) * (1 + annual_return_rate)
    Else:
        evaluation = prev_evaluation * (1 + annual_return_rate) + annual_savings

Retirement period (year_num > saving_period_years):
    evaluation = max(0, prev_evaluation * (1 + annual_return_rate) - target_pension_amount * 12)
"""
from __future__ import annotations

from datetime import date
from typing import Optional


class RetirementSimulationService:
    """Pure calculation service — no DB dependency."""

    MAX_AGE = 100

    @classmethod
    def calculate(
        cls,
        current_age: int,
        annual_return_rate: float,
        lump_sum_amount: Optional[float] = 0,
        annual_savings: Optional[float] = 0,
        saving_period_years: Optional[int] = 0,
        target_pension_amount: Optional[float] = 0,
    ) -> list[dict]:
        """Return yearly projections from current_age to MAX_AGE (inclusive).

        Parameters
        ----------
        current_age:
            Investor's current age.
        annual_return_rate:
            Annual return rate in percent (e.g. 7.0 means 7%).
        lump_sum_amount:
            One-time lump-sum contribution in the first year (만원).
        annual_savings:
            Annual savings contribution during saving period (만원).
        saving_period_years:
            Number of years to contribute annual_savings.
        target_pension_amount:
            Monthly pension withdrawal after saving period (만원).
        """
        lump_sum_amount = lump_sum_amount or 0
        annual_savings = annual_savings or 0
        saving_period_years = saving_period_years or 0
        target_pension_amount = target_pension_amount or 0

        rate = annual_return_rate / 100.0
        current_year = date.today().year

        projections: list[dict] = []
        prev_evaluation: float = 0.0

        total_years = cls.MAX_AGE - current_age + 1

        for year_num in range(1, total_years + 1):
            age = current_age + year_num - 1
            year = current_year + year_num - 1

            in_saving_period = saving_period_years > 0 and year_num <= saving_period_years

            if in_saving_period:
                lump = lump_sum_amount if year_num == 1 else 0
                savings = annual_savings
                # lump_sum + annual_savings added at beginning of year, then compounded
                evaluation = (prev_evaluation + lump + savings) * (1 + rate)
                annual_return = evaluation - (prev_evaluation + lump + savings)
                total_contribution = lump + savings
            else:
                lump = 0
                savings = 0
                # withdraw pension annually (monthly * 12), floor at 0
                evaluation = max(0.0, prev_evaluation * (1 + rate) - target_pension_amount * 12)
                annual_return = prev_evaluation * rate if prev_evaluation > 0 else 0.0
                total_contribution = 0

            projections.append(
                {
                    "year": year,
                    "year_num": year_num,
                    "age": age,
                    "lump_sum": int(round(lump)),
                    "annual_savings": int(round(savings)),
                    "total_contribution": int(round(total_contribution)),
                    "annual_return": round(annual_return, 2),
                    "evaluation": round(evaluation, 2),
                }
            )

            prev_evaluation = evaluation

        return projections
