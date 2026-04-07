"""DesiredPlan ORM model - 은퇴 희망 플랜 (복리 역산 결과 저장)."""
from datetime import datetime
from typing import Optional, TYPE_CHECKING

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.customer_retirement_profile import CustomerRetirementProfile


class DesiredPlan(Base):
    """desired_plans 테이블 - 고객 은퇴 희망 플랜 (복리 역산 결과).

    customer_retirement_profiles 1 : N desired_plans (이론상),
    실제 운용은 profile당 1건 upsert 패턴.
    """

    __tablename__ = "desired_plans"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # FK → customer_retirement_profiles.id (String UUID)
    profile_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("customer_retirement_profiles.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # 입력값
    monthly_desired_amount: Mapped[int] = mapped_column(BigInteger, nullable=False)
    retirement_period_years: Mapped[int] = mapped_column(Integer, nullable=False)

    # 계산 결과 (nullable - 계산 전 상태 허용)
    target_total_fund: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    required_lump_sum: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    required_annual_savings: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)

    # 계산 파라미터 (JSON: annual_rate, years_to_retirement 등)
    calculation_params: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Relationship
    profile: Mapped[Optional["CustomerRetirementProfile"]] = relationship(
        "CustomerRetirementProfile",
        back_populates="desired_plans",
        lazy="select",
    )
