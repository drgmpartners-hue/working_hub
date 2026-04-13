"""DepositTransaction model for deposit account transaction history."""
from datetime import date, datetime
from typing import Optional, TYPE_CHECKING

from sqlalchemy import BigInteger, Date, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.deposit_account import DepositAccount

# Valid transaction type values
TRANSACTION_TYPES = (
    "investment",
    "termination",
    "deposit",
    "withdrawal",
    "interest",
    "other",
)


class DepositTransaction(Base):
    """예수금 거래내역 - 계좌별 입출금/이벤트 내역 및 잔액 자동계산."""

    __tablename__ = "deposit_transactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # FK -> deposit_accounts.id
    deposit_account_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("deposit_accounts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # 이벤트 발생일
    transaction_date: Mapped[date] = mapped_column(Date, nullable=False)

    # 거래 유형: investment / termination / deposit / withdrawal / interest / other
    transaction_type: Mapped[str] = mapped_column(String(20), nullable=False)

    # 관련 상품명 (선택)
    related_product: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)

    # 관련 투자기록 ID (선택, investment_records.id 참조용 - FK 없음)
    investment_record_id: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True
    )

    # 입금액 (원)
    credit_amount: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)

    # 출금액 (원)
    debit_amount: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)

    # 잔액 (원) - 자동계산
    balance: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)

    # 메모 (선택)
    memo: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Relationship
    account: Mapped[Optional["DepositAccount"]] = relationship(
        "DepositAccount",
        back_populates="transactions",
        lazy="select",
    )
