"""Stock theme, recommendation, recommended stock, and company stock pool models."""
from datetime import datetime
from typing import Optional
from sqlalchemy import String, DateTime, ForeignKey, Float, Integer, Boolean, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func
from app.db.base import Base
import uuid


class StockTheme(Base):
    __tablename__ = "stock_themes"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    theme_name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    ai_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    news_summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    stock_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )


class StockRecommendation(Base):
    __tablename__ = "stock_recommendations"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    selected_themes: Mapped[dict] = mapped_column(JSONB, nullable=False)
    ai_scores: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    status: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="stock_recommendations")
    recommended_stocks: Mapped[list["RecommendedStock"]] = relationship(
        "RecommendedStock", back_populates="recommendation", lazy="select"
    )


class RecommendedStock(Base):
    __tablename__ = "recommended_stocks"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    recommendation_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("stock_recommendations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    stock_code: Mapped[str] = mapped_column(String(20), nullable=False)
    stock_name: Mapped[str] = mapped_column(String(200), nullable=False)
    theme: Mapped[str] = mapped_column(String(200), nullable=False)
    rank: Mapped[int] = mapped_column(Integer, nullable=False)
    return_1m: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    return_3m: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    return_6m: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    institutional_buy: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    foreign_buy: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    is_top5: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    analysis_report: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Relationships
    recommendation: Mapped["StockRecommendation"] = relationship(
        "StockRecommendation", back_populates="recommended_stocks"
    )


class CompanyStockPool(Base):
    __tablename__ = "company_stock_pool"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    pool_name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    stocks: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
