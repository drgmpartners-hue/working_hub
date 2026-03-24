"""PortfolioSnapshot and PortfolioHolding ORM models."""
import uuid
from datetime import datetime, date
from typing import Optional, Any, TYPE_CHECKING
from sqlalchemy import String, Float, Integer, Date, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
from app.db.base import Base

if TYPE_CHECKING:
    from app.models.client import ClientAccount


class PortfolioSnapshot(Base):
    __tablename__ = "portfolio_snapshots"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    client_account_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("client_accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    snapshot_date: Mapped[date] = mapped_column(Date, nullable=False)
    image_path: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    parsed_data: Mapped[Optional[Any]] = mapped_column(JSONB, nullable=True)
    deposit_amount: Mapped[Optional[float]] = mapped_column(Float, nullable=True)      # 예수금
    foreign_deposit_amount: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # 외화예수금(원화환산)
    total_assets: Mapped[Optional[float]] = mapped_column(Float, nullable=True)        # 총자산
    total_purchase: Mapped[Optional[float]] = mapped_column(Float, nullable=True)      # 매입금액 합계
    total_evaluation: Mapped[Optional[float]] = mapped_column(Float, nullable=True)    # 평가금액 합계
    total_return: Mapped[Optional[float]] = mapped_column(Float, nullable=True)        # 평가손익 합계
    total_return_rate: Mapped[Optional[float]] = mapped_column(Float, nullable=True)   # 총수익률(%)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    # Relationships
    account: Mapped["ClientAccount"] = relationship("ClientAccount", back_populates="snapshots")
    holdings: Mapped[list["PortfolioHolding"]] = relationship(
        "PortfolioHolding", back_populates="snapshot", cascade="all, delete-orphan"
    )


class PortfolioHolding(Base):
    __tablename__ = "portfolio_holdings"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    snapshot_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("portfolio_snapshots.id", ondelete="CASCADE"), nullable=False, index=True
    )
    product_name: Mapped[str] = mapped_column(String(200), nullable=False)
    product_code: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    product_type: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)    # ETF, 펀드 등
    risk_level: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)       # 절대안정형, 성장형 등
    region: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)           # 국내, 미국, 글로벌, 베트남 등
    quantity: Mapped[Optional[float]] = mapped_column(Float, nullable=True)             # 잔고수량
    purchase_price: Mapped[Optional[float]] = mapped_column(Float, nullable=True)      # 매입가
    current_price: Mapped[Optional[float]] = mapped_column(Float, nullable=True)       # 현재가
    purchase_amount: Mapped[Optional[float]] = mapped_column(Float, nullable=True)     # 매입금액
    evaluation_amount: Mapped[Optional[float]] = mapped_column(Float, nullable=True)   # 평가금액
    total_deposit: Mapped[Optional[float]] = mapped_column(Float, nullable=True)       # 총입금액 (IRP/퇴직연금)
    total_withdrawal: Mapped[Optional[float]] = mapped_column(Float, nullable=True)    # 총출금액 (IRP/퇴직연금)
    return_amount: Mapped[Optional[float]] = mapped_column(Float, nullable=True)       # 평가손익
    return_rate: Mapped[Optional[float]] = mapped_column(Float, nullable=True)         # 수익률(%)
    weight: Mapped[Optional[float]] = mapped_column(Float, nullable=True)              # 비중(%)
    reference_price: Mapped[Optional[float]] = mapped_column(Float, nullable=True)    # 기준가
    seq: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)                # 표시 순서

    # Relationships
    snapshot: Mapped["PortfolioSnapshot"] = relationship("PortfolioSnapshot", back_populates="holdings")
