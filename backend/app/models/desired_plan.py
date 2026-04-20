"""DesiredPlan ORM model - 은퇴 희망 플랜 (복리 역산 결과 저장)."""
from datetime import datetime
from typing import Optional, TYPE_CHECKING

from sqlalchemy import BigInteger, Boolean, DateTime, Float, ForeignKey, Integer, String
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

    # ── 희망은퇴조건 입력값 ──────────────────────────────────────────────
    # 기존 필드 (하위 호환 유지)
    monthly_desired_amount: Mapped[int] = mapped_column(BigInteger, nullable=False)
    retirement_period_years: Mapped[int] = mapped_column(Integer, nullable=False)

    # 신규 입력값 필드
    pension_period_years: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, comment="연금수령기간 (년)")
    current_value_monthly: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True, comment="현재가치 수령액 (원)")
    future_monthly_amount: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True, comment="은퇴당시 수령액 (원)")
    inflation_rate: Mapped[Optional[float]] = mapped_column(Float, nullable=True, comment="물가상승률 (예: 0.025)")
    retirement_pension_rate: Mapped[Optional[float]] = mapped_column(Float, nullable=True, comment="은퇴연금 수익률 (예: 0.05)")
    desired_retirement_age: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, comment="희망 은퇴나이 (세)")
    savings_period_years: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, comment="적립기간 (년)")
    holding_period_years: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, comment="거치기간 (년) = 투자기간 - 적립기간")
    expected_return_rate: Mapped[Optional[float]] = mapped_column(Float, nullable=True, comment="예상수익률 (예: 0.07)")
    annual_savings_amount: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True, comment="연적립 금액 (원)")

    # ── 계산 결과 ────────────────────────────────────────────────────────
    target_retirement_fund: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True, comment="목표 은퇴자금 (원)")
    required_lump_sum_new: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True, comment="필요 거치금액 (원)")

    # 토글 상태
    use_inflation_input: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True, comment="물가반영 토글1 - 은퇴당시수령액 물가반영")
    use_inflation_calc: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True, comment="물가반영 토글2 - 목표자금 계산시 물가반영")

    # ── 복리 성장 시뮬레이션 ─────────────────────────────────────────────
    simulation_monthly_savings: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True, comment="시뮬레이션 월적립금액 (원)")
    simulation_annual_lump_sum: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True, comment="시뮬레이션 연 거치금액 (원)")
    simulation_total_lump_sum: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True, comment="시뮬레이션 총 거치금액 (원)")
    simulation_target_fund: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True, comment="시뮬레이션 목표 은퇴자금 (원)")
    plan_start_year: Mapped[Optional[int]] = mapped_column(nullable=True, comment="플랜 시작연도")
    simulation_data: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True, comment="연차별 시뮬레이션 데이터 JSON")

    # ── 기존 하위 호환 필드 ──────────────────────────────────────────────
    target_total_fund: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    required_lump_sum: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    required_annual_savings: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)

    # 계산 파라미터 (JSON: 모든 계산 결과 + 파라미터 백업)
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
