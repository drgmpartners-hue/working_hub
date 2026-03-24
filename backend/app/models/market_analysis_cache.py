"""시황 분석 캐시 — 키워드별 Gemini 분석 결과 저장."""
import uuid
from datetime import datetime
from sqlalchemy import String, Text, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func
from app.db.base import Base


class MarketAnalysisCache(Base):
    __tablename__ = "market_analysis_cache"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    keyword: Mapped[str] = mapped_column(String(100), nullable=False, unique=True, index=True)
    news_summary: Mapped[str] = mapped_column(Text, nullable=False)  # 뉴스 원문 요약
    analysis: Mapped[str] = mapped_column(Text, nullable=False)  # Gemini 시황 분석
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
