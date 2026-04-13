"""DepositAccount model for retirement cash account tracking."""
from datetime import datetime
from typing import Optional, List, TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.deposit_transaction import DepositTransaction


class DepositAccount(Base):
    """예수금 계좌 - 고객별 증권사 예수금 계좌 관리."""

    __tablename__ = "deposit_accounts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # 프로필 ID (customer_retirement_profiles.id, FK 없이 유연하게)
    profile_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)

    # 고객 ID (빠른 조회용)
    customer_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)

    # 증권사명
    securities_company: Mapped[str] = mapped_column(String(100), nullable=False)

    # 계좌번호 (선택)
    account_number: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)

    # 계좌 별명 (선택)
    nickname: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    # 활성 여부
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Relationship
    transactions: Mapped[List["DepositTransaction"]] = relationship(
        "DepositTransaction",
        back_populates="account",
        cascade="all, delete-orphan",
        lazy="select",
    )
