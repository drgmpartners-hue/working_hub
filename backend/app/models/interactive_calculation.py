"""InteractiveCalculation model for plan vs actual comparison."""
from datetime import datetime
from decimal import Decimal
from typing import Optional, TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.customer_retirement_profile import CustomerRetirementProfile


class InteractiveCalculation(Base):
    """인터랙티브 계산 결과 - 계획 대비 실제 비교 및 수정 예측."""

    __tablename__ = "interactive_calculations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # FK -> customer_retirement_profiles.id (UUID String)
    profile_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("customer_retirement_profiles.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # 계산 기준 연도 (실제 데이터 마지막 연도)
    plan_year: Mapped[int] = mapped_column(Integer, nullable=False)

    # 실제 데이터 (연도별 실제 투자 흐름 + 계획 대비 비교)
    actual_data: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True)

    # 수정 예측 데이터 (마지막 실제 평가액 기준으로 재시뮬레이션)
    projected_data: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True)

    # 이격률 = (실제 - 계획) / 계획 × 100
    deviation_rate: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(5, 2), nullable=True
    )

    # AI 가이드 결과 텍스트
    ai_guide_result: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Relationship
    profile: Mapped[Optional["CustomerRetirementProfile"]] = relationship(
        "CustomerRetirementProfile",
        back_populates="interactive_calculations",
        lazy="select",
    )
