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
    """연간 투자흐름표 집계 — '그 해에 실현한 성과' 기준.

    총투자금액·연간평가금액·연간총수익·연수익률은 **그 해에 종결된 투자**만으로
    산출한다. 여러 해에 걸친 투자는 종결된 해에 한 번만 집계되므로,
    직전 연도에는 목록에 표시되기만 하고 금액에는 포함되지 않는다.
    운용 중인 자산은 순자산(연말 예수금 잔액 + 운용중 평가)이 담당한다.

    Args:
        records: 고객의 **전체** 투자기록 (모든 연도)
        year: 집계 대상 연도

    Returns:
        dict: 연간 투자흐름표 집계 결과
    """
    lump_sum_amount = 0          # 당해 일시납금액 (예수금 입금 유형만, 투자 제외)
    withdrawal_amount = 0        # 당해 인출금액

    # 총투자금액·연간평가금액은 '그 해에 종결된' 투자만 집계한다(당해 실현 성과).
    total_payment = 0            # 총투자금액: 당해 종결 상품의 원금 합
    annual_evaluation = 0        # 연간평가금액: 당해 종결 상품의 평가금액 합

    for rec in records:
        record_type = rec.get("record_type")
        investment_amount = rec.get("investment_amount") or 0
        evaluation_amount = rec.get("evaluation_amount")
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

        # 총투자금액·연간평가금액: '그 해에 종결된' 투자만 집계한다.
        #
        # 여러 해에 걸친 투자를 매년 계상하면 같은 건이 두 번 이상 잡혀 금액이
        # 부풀려진다(예: 2025.06 투자 → 2026.03 종결 건이 두 해 모두 계상).
        # 종결된 해에 한 번만 집계하면 중복이 사라지고, 이 네 컬럼은
        # '그 해에 실현한 성과'라는 하나의 의미를 갖는다.
        #
        # 아직 운용 중인 자산은 순자산(연말 예수금 잔액 + 운용중 평가)이 담당하므로
        # 정보 손실은 없다. 중간평가도 순자산에만 반영되어, 미실현 수익이 이 표의
        # 연간총수익에 먼저 잡혔다가 종결 시 다시 잡히는 이중계상이 발생하지 않는다.
        #
        # 종결 판정은 순자산 계산(e_year > year 이면 운용중)과 어긋나지 않도록
        # status 가 아닌 종료일 기준으로 한다.
        # 같은 해에 엑싯 후 재투자한 '회전'은 서로 다른 투자 건이므로 각각 집계한다.
        if record_type != "withdrawal" and end_year == year:
            total_payment += investment_amount
            annual_evaluation += (evaluation_amount or investment_amount)

    # 연간총수익: 당해 실현손익 = 회수금액(평가) - 투자원금
    annual_total_profit = annual_evaluation - total_payment

    # 연수익률: 실현손익 / 당해 투자원금 * 100 (종결 없는 해는 None)
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
