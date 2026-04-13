"""InvestmentRecord model for retirement investment tracking."""
from datetime import date, datetime
from decimal import Decimal
from typing import Optional, TYPE_CHECKING

from sqlalchemy import (
    BigInteger,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.customer_retirement_profile import CustomerRetirementProfile
    from app.models.wrap_account import WrapAccount


class InvestmentRecord(Base):
    """투자기록 - 은퇴 설계 프로필별 투자/적립/인출 내역."""

    __tablename__ = "investment_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # FK -> customer_retirement_profiles.id (UUID String)
    profile_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("customer_retirement_profiles.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # FK -> wrap_accounts.id (nullable)
    wrap_account_id: Mapped[Optional[int]] = mapped_column(
        Integer,
        ForeignKey("wrap_accounts.id", ondelete="SET NULL"),
        nullable=True,
    )

    # FK -> deposit_accounts.id (예수금 계좌 연결)
    deposit_account_id: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True,
    )

    # investment / additional_savings / withdrawal
    record_type: Mapped[str] = mapped_column(String(20), nullable=False)

    product_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    # 만원 단위
    investment_amount: Mapped[int] = mapped_column(BigInteger, nullable=False)

    # exit 시 평가금액
    evaluation_amount: Mapped[Optional[int]] = mapped_column(
        BigInteger, nullable=True
    )

    # 수익률 (자동계산): (evaluation - investment) / investment * 100
    return_rate: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(5, 2), nullable=True
    )

    # ing / exit / deposit
    status: Mapped[str] = mapped_column(String(10), nullable=False)

    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    # 날짜 필드
    join_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    expected_maturity_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    actual_maturity_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    original_maturity_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    # 자기참조 FK (이전 상품)
    predecessor_id: Mapped[Optional[int]] = mapped_column(
        Integer,
        ForeignKey("investment_records.id", ondelete="SET NULL"),
        nullable=True,
    )

    # 자기참조 FK (다음 상품)
    successor_id: Mapped[Optional[int]] = mapped_column(
        Integer,
        ForeignKey("investment_records.id", ondelete="SET NULL"),
        nullable=True,
    )

    memo: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Relationships
    profile: Mapped[Optional["CustomerRetirementProfile"]] = relationship(
        "CustomerRetirementProfile",
        back_populates="investment_records",
        lazy="select",
    )
    wrap_account: Mapped[Optional["WrapAccount"]] = relationship(
        "WrapAccount",
        lazy="select",
    )
    predecessor: Mapped[Optional["InvestmentRecord"]] = relationship(
        "InvestmentRecord",
        foreign_keys="[InvestmentRecord.predecessor_id]",
        primaryjoin="InvestmentRecord.predecessor_id == InvestmentRecord.id",
        lazy="select",
        uselist=False,
    )
    successor: Mapped[Optional["InvestmentRecord"]] = relationship(
        "InvestmentRecord",
        foreign_keys="[InvestmentRecord.successor_id]",
        primaryjoin="InvestmentRecord.successor_id == InvestmentRecord.id",
        lazy="select",
        uselist=False,
    )
