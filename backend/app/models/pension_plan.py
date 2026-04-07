"""PensionPlan model for pension distribution planning."""
from datetime import datetime
from typing import Optional, TYPE_CHECKING
from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func
from app.db.base import Base

if TYPE_CHECKING:
    from app.models.customer_retirement_profile import CustomerRetirementProfile

# Valid pension type values
PENSION_TYPES = ("lifetime", "fixed", "inheritance")


class PensionPlan(Base):
    """연금 지급 계획 - 프로필별 연금 지급 방법 및 계산 결과 보관."""

    __tablename__ = "pension_plans"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # FK -> customer_retirement_profiles.id (UUID String)
    profile_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("customer_retirement_profiles.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # 연금 지급 유형: lifetime(종신형) / fixed(확정형) / inheritance(상속형)
    pension_type: Mapped[str] = mapped_column(String(20), nullable=False)

    # 모으는 기간 요약 (JSONB)
    accumulation_summary: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)

    # 연금 지급 계획 (연도별 잔액 배열, JSONB)
    distribution_plan: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True)

    # 통합 그래프 데이터 (모으는 기간 + 쓰는 기간 합산, JSONB)
    combined_graph_data: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Relationship
    profile: Mapped[Optional["CustomerRetirementProfile"]] = relationship(
        "CustomerRetirementProfile", back_populates="pension_plans", lazy="select"
    )
