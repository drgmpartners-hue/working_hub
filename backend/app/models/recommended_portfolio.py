"""Dr.GM 추천 포트폴리오 - 전 고객 공통 추천 포트폴리오 템플릿."""
import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import String, DateTime, Float, Integer
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func
from app.db.base import Base


class RecommendedPortfolioItem(Base):
    __tablename__ = "recommended_portfolio_items"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    product_name: Mapped[str] = mapped_column(String(300), nullable=False)
    product_code: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    product_type: Mapped[Optional[str]] = mapped_column(
        String(100), nullable=True
    )  # ETF/펀드/MMF 등
    region: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    current_price: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    weight_pension: Mapped[Optional[float]] = mapped_column(
        Float, nullable=True
    )  # 연금저축 비중 0.0~1.0
    weight_irp: Mapped[Optional[float]] = mapped_column(
        Float, nullable=True
    )  # IRP/퇴직연금 비중 0.0~1.0
    memo: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    seq: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )
