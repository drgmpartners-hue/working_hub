"""예수금 '마지막 거래' 판정 정렬 회귀 테스트.

잔액은 (날짜, 입금우선, id) 순서로 누적 재계산되는데, 이를 읽어오는 쪽이
(날짜, id)로만 뒤에서 뽑으면 같은 날짜에 나중 id로 등록된 입금성 거래의
잔액을 최종 잔액으로 오인한다. 실제로 순자산이 2억 넘게 부풀려진 사례가 있었다.
"""
from app.api.v1.deposit_accounts import last_tx_order
from app.models.deposit_transaction import DepositTransaction


def _priority(tx) -> int:
    """recalculate_balances 의 _intraday_priority 와 동일 규칙."""
    is_credit = (tx["credit"] + tx["savings"]) > 0 and tx["debit"] == 0
    return 0 if is_credit else 1


# 실제 발생 케이스: 2026-06-22 에 투자 3건(출금) + 종료 1건(입금),
# 종료 거래가 가장 나중에 등록되어 id 가 가장 크다.
CASE = [
    {"id": 36, "date": "2026-06-22", "credit": 0, "savings": 0, "debit": 118627178, "balance": 79991651},
    {"id": 37, "date": "2026-06-22", "credit": 0, "savings": 0, "debit": 50000000, "balance": 29991651},
    {"id": 38, "date": "2026-06-22", "credit": 0, "savings": 0, "debit": 33400000, "balance": -3408349},
    {"id": 39, "date": "2026-06-22", "credit": 84662852, "savings": 0, "debit": 0, "balance": 198618829},
]


class TestLastTransactionOrder:
    def test_recalc_order_puts_credit_first(self):
        """재계산 정렬은 같은 날짜에 입금성 거래를 먼저 둔다."""
        ordered = sorted(CASE, key=lambda t: (t["date"], _priority(t), t["id"]))
        assert [t["id"] for t in ordered] == [39, 36, 37, 38]

    def test_last_balance_is_final_outflow_not_max_id(self):
        """최종 잔액은 id 최대(39)가 아니라 재계산 순서상 마지막(38)이어야 한다."""
        ordered = sorted(CASE, key=lambda t: (t["date"], _priority(t), t["id"]))
        assert ordered[-1]["id"] == 38
        assert ordered[-1]["balance"] == -3408349

    def test_naive_date_id_order_picks_wrong_row(self):
        """(날짜, id) 만으로 뽑으면 종료 거래의 잔액을 집어 순자산이 부풀려진다."""
        naive_last = sorted(CASE, key=lambda t: (t["date"], t["id"]))[-1]
        assert naive_last["id"] == 39
        assert naive_last["balance"] == 198618829  # 잘못된 값 — 회귀 감지용

    def test_last_tx_order_clause_shape(self):
        """정렬절은 (날짜 desc, 입금우선 desc, id desc) 3단이어야 한다."""
        clauses = last_tx_order()
        assert len(clauses) == 3
        compiled = [str(c) for c in clauses]
        assert "transaction_date DESC" in compiled[0]
        assert "DESC" in compiled[1] and "CASE" in compiled[1].upper()
        assert str(DepositTransaction.id.desc()) in compiled[2]
