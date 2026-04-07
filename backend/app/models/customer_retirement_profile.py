"""CustomerRetirementProfile model for IRP/pension retirement planning."""
import uuid
from datetime import datetime
from typing import Optional, TYPE_CHECKING
from sqlalchemy import String, BigInteger, Integer, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func
from app.db.base import Base

if TYPE_CHECKING:
    from app.models.user import User
    from app.models.investment_record import InvestmentRecord
    from app.models.desired_plan import DesiredPlan
    from app.models.retirement_plan import RetirementPlan
    from app.models.interactive_calculation import InteractiveCalculation
    from app.models.pension_plan import PensionPlan


class CustomerRetirementProfile(Base):
    """은퇴 설계 프로필 - 고객(user)별 1건 보관."""

    __tablename__ = "customer_retirement_profiles"
    __table_args__ = (
        UniqueConstraint("customer_id", name="uq_customer_retirement_profile_customer"),
    )

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    # FK -> users.id (UUID String)
    customer_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    # 목표 은퇴 자산 (단위: 원)
    target_retirement_fund: Mapped[int] = mapped_column(BigInteger, nullable=False)
    # 원하는 월 연금액 (단위: 원)
    desired_pension_amount: Mapped[int] = mapped_column(BigInteger, nullable=False)
    # 설계 당시 나이
    age_at_design: Mapped[int] = mapped_column(Integer, nullable=False)
    # 현재 나이
    current_age: Mapped[int] = mapped_column(Integer, nullable=False)
    # 희망 은퇴 나이
    desired_retirement_age: Mapped[int] = mapped_column(Integer, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Relationships
    customer: Mapped[Optional["User"]] = relationship(
        "User", back_populates="retirement_profile", lazy="select"
    )
    desired_plans: Mapped[list["DesiredPlan"]] = relationship(
        "DesiredPlan", back_populates="profile", cascade="all, delete-orphan", lazy="select"
    )
    investment_records: Mapped[list["InvestmentRecord"]] = relationship(
        "InvestmentRecord",
        back_populates="profile",
        lazy="select",
        cascade="all, delete-orphan",
    )
    plans: Mapped[list["RetirementPlan"]] = relationship(
        "RetirementPlan",
        back_populates="profile",
        cascade="all, delete-orphan",
        lazy="select",
    )
    interactive_calculations: Mapped[list["InteractiveCalculation"]] = relationship(
        "InteractiveCalculation",
        back_populates="profile",
        cascade="all, delete-orphan",
        lazy="select",
    )
    pension_plans: Mapped[list["PensionPlan"]] = relationship(
        "PensionPlan",
        back_populates="profile",
        cascade="all, delete-orphan",
        lazy="select",
    )
