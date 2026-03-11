"""Portfolio analysis and portfolio item models."""
from datetime import datetime
from typing import Optional
from sqlalchemy import String, DateTime, ForeignKey, Float
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func
from app.db.base import Base
import uuid


class PortfolioAnalysis(Base):
    __tablename__ = "portfolio_analyses"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    data_source: Mapped[str] = mapped_column(String(100), nullable=False)
    raw_data: Mapped[dict] = mapped_column(JSONB, nullable=False)
    template_data: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    ai_analysis: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    rebalancing_suggestions: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    report_file_path: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    status: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="portfolio_analyses")
    items: Mapped[list["PortfolioItem"]] = relationship(
        "PortfolioItem", back_populates="analysis", lazy="select"
    )


class PortfolioItem(Base):
    __tablename__ = "portfolio_items"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    analysis_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("portfolio_analyses.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    product_name: Mapped[str] = mapped_column(String(200), nullable=False)
    product_type: Mapped[str] = mapped_column(String(100), nullable=False)
    current_value: Mapped[float] = mapped_column(Float, nullable=False)
    return_rate: Mapped[float] = mapped_column(Float, nullable=False)
    details: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)

    # Relationships
    analysis: Mapped["PortfolioAnalysis"] = relationship(
        "PortfolioAnalysis", back_populates="items"
    )
