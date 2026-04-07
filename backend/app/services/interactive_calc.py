"""Interactive calculation service for plan vs actual comparison.

Logic
-----
1. 3번탭 retirement_plans의 yearly_projections 로드 (계획 데이터)
2. 2번탭 investment_records에서 annual_flow 계산 (실제 데이터)
3. 연도별 비교: 계획 평가액 vs 실제 평가액
4. 이격률 = (실제 - 계획) / 계획 × 100
5. 실제 데이터 있는 연도까지 = actual, 이후 = projected (수정 예측)
6. 수정 예측: 마지막 실제 평가액을 기준으로 남은 기간 시뮬레이션
"""
from __future__ import annotations

from typing import Any, Optional

from app.services.annual_flow_calc import calculate_annual_flow


class InteractiveCalcService:
    """Pure calculation service — no DB dependency."""

    @staticmethod
    def compute_deviation_rate(
        planned: float,
        actual: float,
    ) -> Optional[float]:
        """이격률 계산: (실제 - 계획) / 계획 × 100.

        Args:
            planned: 계획 평가액
            actual: 실제 평가액

        Returns:
            float: 이격률 (%) 또는 None (계획이 0인 경우)
        """
        if planned == 0:
            return None
        rate = (actual - planned) / planned * 100
        return round(rate, 2)

    @staticmethod
    def build_actual_data(
        records: list[dict[str, Any]],
        plan_year: int,
        yearly_projections: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """실제 데이터 구성.

        투자 기록을 연도별로 집계하여 계획 데이터와 비교합니다.
        실제 데이터가 있는 연도(start_date 기준)만 포함합니다.

        Args:
            records: 투자 기록 목록 (dict 형태)
            plan_year: 계산 기준 연도 (실제 데이터 마지막 연도)
            yearly_projections: 계획 연도별 예상 평가금액 배열

        Returns:
            list: 연도별 실제 vs 계획 비교 데이터
        """
        # yearly_projections를 연도 키로 인덱싱
        plan_by_year: dict[int, dict] = {
            p["year"]: p for p in yearly_projections
        }

        # 투자 기록에서 실제 데이터가 있는 연도 추출
        actual_years: set[int] = set()
        for rec in records:
            start_date = rec.get("start_date")
            if start_date is not None:
                rec_year = (
                    start_date.year
                    if hasattr(start_date, "year")
                    else int(str(start_date)[:4])
                )
                actual_years.add(rec_year)

        # plan_year까지의 연도만 포함
        actual_years = {y for y in actual_years if y <= plan_year}

        result: list[dict[str, Any]] = []

        for year in sorted(actual_years):
            flow = calculate_annual_flow(records=records, year=year)
            actual_evaluation = flow["annual_evaluation_amount"]
            plan_entry = plan_by_year.get(year, {})
            planned_evaluation = float(plan_entry.get("evaluation", 0))

            deviation = InteractiveCalcService.compute_deviation_rate(
                planned=planned_evaluation,
                actual=float(actual_evaluation),
            )

            result.append(
                {
                    "year": year,
                    "age": plan_entry.get("age"),
                    "year_num": plan_entry.get("year_num"),
                    "actual_evaluation": actual_evaluation,
                    "planned_evaluation": planned_evaluation,
                    "deviation_rate": deviation,
                    "lump_sum_amount": flow["lump_sum_amount"],
                    "annual_savings_amount": flow["annual_savings_amount"],
                    "total_payment": flow["total_payment"],
                    "annual_total_profit": flow["annual_total_profit"],
                    "annual_return_rate": flow["annual_return_rate"],
                    "withdrawal_amount": flow["withdrawal_amount"],
                }
            )

        return result

    @staticmethod
    def build_projected_data(
        last_actual_evaluation: float,
        annual_return_rate: float,
        target_pension_amount: float,
        remaining_projections: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """수정 예측 데이터 구성.

        마지막 실제 평가액을 기준으로 남은 기간을 재시뮬레이션합니다.
        (연적립금 없음, 연금 인출만 적용)

        Args:
            last_actual_evaluation: 마지막 실제 평가액 (만원)
            annual_return_rate: 연수익률 (%)
            target_pension_amount: 목표 월연금액 (만원) - 연 × 12 인출
            remaining_projections: 계획의 나머지 yearly_projections 항목들

        Returns:
            list: 수정 예측 연도별 데이터
        """
        rate = annual_return_rate / 100.0
        prev_evaluation = last_actual_evaluation

        result: list[dict[str, Any]] = []

        for entry in remaining_projections:
            # 이후 연도는 순수 운용 (연금 인출만, 신규 적립 없음)
            new_evaluation = max(
                0.0,
                prev_evaluation * (1 + rate) - target_pension_amount * 12,
            )
            result.append(
                {
                    "year": entry["year"],
                    "age": entry.get("age"),
                    "year_num": entry.get("year_num"),
                    "evaluation": round(new_evaluation, 2),
                    "original_planned_evaluation": float(
                        entry.get("evaluation", 0)
                    ),
                }
            )
            prev_evaluation = new_evaluation

        return result

    @classmethod
    def run(
        cls,
        records: list[dict[str, Any]],
        plan_year: int,
        yearly_projections: list[dict[str, Any]],
        annual_return_rate: float,
        target_pension_amount: float,
    ) -> dict[str, Any]:
        """인터랙티브 계산 실행.

        Args:
            records: 투자 기록 목록
            plan_year: 계산 기준 연도 (실제 데이터 마지막 연도)
            yearly_projections: 계획의 yearly_projections
            annual_return_rate: 연수익률 (%)
            target_pension_amount: 목표 월연금액 (만원)

        Returns:
            dict: actual_data, projected_data, deviation_rate
        """
        # 1. 실제 데이터 구성
        actual_data = cls.build_actual_data(
            records=records,
            plan_year=plan_year,
            yearly_projections=yearly_projections,
        )

        # 2. 수정 예측 데이터 구성 (plan_year 이후 연도들)
        remaining_projections = [
            p for p in yearly_projections if p["year"] > plan_year
        ]

        # 마지막 실제 평가액 추출
        if actual_data:
            last_actual_evaluation = float(actual_data[-1]["actual_evaluation"])
        else:
            # 실제 데이터가 없으면 계획 데이터의 plan_year 기준 평가액 사용
            plan_by_year = {p["year"]: p for p in yearly_projections}
            last_actual_evaluation = float(
                plan_by_year.get(plan_year, {}).get("evaluation", 0)
            )

        projected_data = cls.build_projected_data(
            last_actual_evaluation=last_actual_evaluation,
            annual_return_rate=annual_return_rate,
            target_pension_amount=target_pension_amount,
            remaining_projections=remaining_projections,
        )

        # 3. 이격률 계산 (실제 데이터의 마지막 연도 기준)
        deviation_rate: Optional[float] = None
        if actual_data:
            last = actual_data[-1]
            deviation_rate = last.get("deviation_rate")

        return {
            "actual_data": actual_data,
            "projected_data": projected_data,
            "deviation_rate": deviation_rate,
        }
