"""User model for authentication."""
from datetime import datetime
from typing import Optional, TYPE_CHECKING
from sqlalchemy import String, Boolean, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func
from app.db.base import Base
import uuid

if TYPE_CHECKING:
    from app.models.customer_retirement_profile import CustomerRetirementProfile


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    nickname: Mapped[str] = mapped_column(String(50), nullable=False)
    phone: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    profile_image: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_superuser: Mapped[bool] = mapped_column(Boolean, default=False)
    # 역할: "owner"(대표) | "manager"(매니저). 판정은 app/core/permissions.py 에서만.
    # is_superuser 는 역할 판정에 쓰지 않는다(의미 불명확, 지시서 5.1).
    role: Mapped[str] = mapped_column(
        String(20), nullable=False, default="manager", server_default="manager", index=True
    )
    # 어느 대표가 만든 매니저인지 (감사 목적)
    created_by_user_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # is_active=False 전환 시각 (퇴사 처리 이력)
    deactivated_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    # 사용 프로그램 (docs/login_logic P11): NULL = 전부, 목록 = 대표가 열어 준 프로그램만. 키는 app/core/programs.py
    allowed_programs: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True)
    last_login: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Relationships
    commission_calculations: Mapped[list["CommissionCalculation"]] = relationship(
        "CommissionCalculation", back_populates="user", lazy="select"
    )
    portfolio_analyses: Mapped[list["PortfolioAnalysis"]] = relationship(
        "PortfolioAnalysis", back_populates="user", lazy="select"
    )
    stock_recommendations: Mapped[list["StockRecommendation"]] = relationship(
        "StockRecommendation", back_populates="user", lazy="select"
    )
    content_projects: Mapped[list["ContentProject"]] = relationship(
        "ContentProject", back_populates="user", lazy="select"
    )
    clients: Mapped[list["Client"]] = relationship(
        "Client", back_populates="user", lazy="select"
    )
    # 은퇴 프로필은 이제 Client(고객)에 귀속 → Client.retirement_profile 참조

    @property
    def programs(self) -> list[str]:
        """화면에 내려 줄 사용 가능 프로그램(대표·전부 허용이면 전체)."""
        from app.core.programs import effective_list

        return effective_list(self)
