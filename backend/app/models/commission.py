"""Commission calculation and result models."""
from datetime import datetime
from typing import Optional
from sqlalchemy import String, DateTime, ForeignKey, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func
from app.db.base import Base
import uuid


class CommissionCalculation(Base):
    __tablename__ = "commission_calculations"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    calc_type: Mapped[str] = mapped_column(String(100), nullable=False)
    source_file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    input_data: Mapped[dict] = mapped_column(JSONB, nullable=False)
    result_data: Mapped[dict] = mapped_column(JSONB, nullable=False)
    status: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="commission_calculations")
    results: Mapped[list["CommissionResult"]] = relationship(
        "CommissionResult", back_populates="calculation", lazy="select"
    )


class CommissionResult(Base):
    __tablename__ = "commission_results"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    calculation_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("commission_calculations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    employee_name: Mapped[str] = mapped_column(String(100), nullable=False)
    detail_data: Mapped[dict] = mapped_column(JSONB, nullable=False)
    report_file_path: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    # Relationships
    calculation: Mapped["CommissionCalculation"] = relationship(
        "CommissionCalculation", back_populates="results"
    )
