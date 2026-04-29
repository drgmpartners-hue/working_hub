"""Annual investment flow calculation service for retirement planning."""
from typing import Any, Optional


def calculate_return_rate(
    investment_amount: int,
    evaluation_amount: Optional[int],
) -> Optional[float]:
    """수익률 자동 계산: (evaluation - investment) / investment * 100."""
    if evaluation_amount is None:
        return None
    if investment_amount == 0:
        return None
    rate = (evaluation_amount - investment_amount) / investment_amount * 100
    return round(rate, 2)


def calculate_annual_flow(
    records: list[dict[str, Any]],
    year: int,
) -> dict[str, Any]:
    """연간 투자흐름표 집계 - 새 계산 방식.

    Args:
        records: 고객의 **전체** 투자기록 (모든 연도)
        year: 집계 대상 연도

    Returns:
        dict: 연간 투자흐름표 집계 결과
    """
    lump_sum_amount = 0          # 당해 일시납금액 (예수금 입금 유형만, 투자 제외)
    withdrawal_amount = 0        # 당해 인출금액

    # 모든 미종결 투자 추적
    total_payment = 0            # 총납입금액: 당해 투자금액 + 모든 미종결 투자금액
    annual_evaluation = 0        # 연간평가금액: 당해 종결 평가금액 + 미종결 투자금액

    for rec in records:
        record_type = rec.get("record_type")
        investment_amount = rec.get("investment_amount") or 0
        evaluation_amount = rec.get("evaluation_amount")
        interim_evals = rec.get("interim_evaluations") or {}
        rec_status = rec.get("status")
        start_date = rec.get("start_date")
        end_date = rec.get("end_date")

        # 연도 추출
        if start_date is not None:
            start_year = start_date.year if hasattr(start_date, "year") else int(str(start_date)[:4])
        else:
            start_year = year

        if end_date is not None:
            end_year = end_date.year if hasattr(end_date, "year") else int(str(end_date)[:4])
        else:
            end_year = 9999

        # 당해 시작된 기록: 인출 집계 (일시납은 예수금 거래 기반으로 별도 처리)
        if start_year == year:
            if record_type == "withdrawal":
                withdrawal_amount += investment_amount

        # 총납입금액: 해당 연도 기준 아직 살아있는(=미종결 OR 당해종결) 투자
        # 조건: 시작년 <= year AND (종료년 >= year OR 미종결)
        if start_year <= year and end_year >= year:
            total_payment += investment_amount

        # 연간평가금액:
        # - 당해 종결: 평가금액 사용
        # - 미종결: 중간평가 있으면 중간평가, 없으면 투자금액(원금)
        if end_year == year and rec_status == "exit":
            # 당해 종결된 상품 → 평가금액
            annual_evaluation += (evaluation_amount or investment_amount)
        elif start_year <= year and end_year > year:
            # 해당 연도에 활성이지만 아직 미종결
            interim_val = interim_evals.get(str(year))
            if interim_val is not None:
                annual_evaluation += interim_val
            else:
                annual_evaluation += investment_amount

    # 연간총수익: 연간평가금액 - 총납입금액
    annual_total_profit = annual_evaluation - total_payment

    # 연수익률: 연간총수익 / 총납입금액 * 100
    annual_return_rate = None
    if total_payment > 0:
        annual_return_rate = round(annual_total_profit / total_payment * 100, 2)

    return {
        "year": year,
        "lump_sum_amount": lump_sum_amount,
        "annual_savings_amount": 0,  # 예수금 적립으로 덮어씀
        "total_payment": total_payment,
        "annual_total_profit": annual_total_profit,
        "annual_evaluation_amount": annual_evaluation,
        "annual_return_rate": annual_return_rate,
        "withdrawal_amount": withdrawal_amount,
    }
