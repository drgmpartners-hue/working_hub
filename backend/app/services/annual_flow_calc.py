"""Annual investment flow calculation service for retirement planning."""
from typing import Any, Optional


def calculate_return_rate(
    investment_amount: int,
    evaluation_amount: Optional[int],
) -> Optional[float]:
    """수익률 자동 계산: (evaluation - investment) / investment * 100.

    Returns:
        float: 수익률 (%) 또는 None (계산 불가 시)
    """
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
    """연간 투자흐름표 집계.

    Args:
        records: 해당 고객의 투자기록 목록 (dict 형태)
        year: 집계 대상 연도

    Returns:
        dict: 연간 투자흐름표 집계 결과
    """
    lump_sum_amount = 0          # 일시납금액 (investment 유형)
    annual_savings_amount = 0    # 연적립금액 (additional_savings 유형)
    annual_total_profit = 0      # 연간총수익 (exit 상품의 평가 - 투자)
    annual_evaluation_amount = 0 # 연간평가금액
    withdrawal_amount = 0        # 인출금액 (withdrawal 유형)

    for rec in records:
        record_type = rec.get("record_type")
        investment_amount = rec.get("investment_amount") or 0
        evaluation_amount = rec.get("evaluation_amount")
        status = rec.get("status")
        start_date = rec.get("start_date")

        # 해당 연도에 시작된 기록만 집계 (start_date 기준)
        if start_date is not None:
            rec_year = start_date.year if hasattr(start_date, "year") else int(str(start_date)[:4])
        else:
            rec_year = year  # start_date 없으면 포함

        if rec_year != year:
            continue

        if record_type == "investment":
            lump_sum_amount += investment_amount

        elif record_type == "additional_savings":
            annual_savings_amount += investment_amount

        elif record_type == "withdrawal":
            withdrawal_amount += investment_amount

        # exit 상품: 수익 집계
        if status == "exit" and evaluation_amount is not None:
            profit = evaluation_amount - investment_amount
            annual_total_profit += profit
            annual_evaluation_amount += evaluation_amount
        elif status == "ing":
            # ing 상품: 평가금액이 있으면 사용, 없으면 투자금액으로 대체
            eval_val = evaluation_amount if evaluation_amount is not None else investment_amount
            annual_evaluation_amount += eval_val
        elif status == "deposit":
            # 예수금: 투자금액을 평가금액으로 사용
            annual_evaluation_amount += investment_amount

    total_payment = lump_sum_amount + annual_savings_amount

    # 연수익률: 연간총수익 / (총납입금액) * 100 (총납입 > 0인 경우)
    annual_return_rate = None
    if total_payment > 0:
        annual_return_rate = round(annual_total_profit / total_payment * 100, 2)

    return {
        "year": year,
        "lump_sum_amount": lump_sum_amount,
        "annual_savings_amount": annual_savings_amount,
        "total_payment": total_payment,
        "annual_total_profit": annual_total_profit,
        "annual_evaluation_amount": annual_evaluation_amount,
        "annual_return_rate": annual_return_rate,
        "withdrawal_amount": withdrawal_amount,
    }
