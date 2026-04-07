"""RetirementPlan model for retirement simulation plans."""
from datetime import datetime
from typing import Optional, TYPE_CHECKING
from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Integer, Numeric, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func
from app.db.base import Base

if TYPE_CHECKING:
    from app.models.customer_retirement_profile import CustomerRetirementProfile


class RetirementPlan(Base):
    """은퇴 설계 시뮬레이션 플랜 - 프로필별 여러 건 보관."""

    __tablename__ = "retirement_plans"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # FK -> customer_retirement_profiles.id (UUID String)
    profile_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("customer_retirement_profiles.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    current_age: Mapped[int] = mapped_column(Integer, nullable=False)

    # 일시납입금액 (단위: 만원)
    lump_sum_amount: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)

    # 연적립금액 (단위: 만원)
    annual_savings: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)

    # 납입기간 (년)
    saving_period_years: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # 물가상승률 (%)
    inflation_rate: Mapped[Optional[float]] = mapped_column(
        Numeric(5, 2), nullable=True
    )

    # 연수익률 (%)
    annual_return_rate: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False)

    # 목표은퇴자금 (단위: 만원)
    target_retirement_fund: Mapped[Optional[int]] = mapped_column(
        BigInteger, nullable=True
    )

    # 목표연금액 월 (단위: 만원)
    target_pension_amount: Mapped[Optional[int]] = mapped_column(
        BigInteger, nullable=True
    )

    # 희망은퇴나이
    desired_retirement_age: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True
    )

    # 가능은퇴나이
    possible_retirement_age: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True
    )

    inheritance_consideration: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )

    # 연도별 예상 평가금액 배열 (JSONB)
    yearly_projections: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Relationship
    profile: Mapped[Optional["CustomerRetirementProfile"]] = relationship(
        "CustomerRetirementProfile", back_populates="plans", lazy="select"
    )
