"""야간 배치 사전계산 지표 + 보정용 스냅샷 (08-stock-etf-recommend P5-R1).

- stock_daily_metrics: 전종목(한정 유니버스) 일별 지표 — 스크리닝/추천이 DB 조회로 동작.
- score_snapshots: 전향적 스냅샷 — 비가격 축(수급·실적) 가중치 사후검증 보정용.
"""
from datetime import datetime, date
from typing import Optional

from sqlalchemy import String, DateTime, Date, Float, BigInteger, Boolean, Integer, UniqueConstraint, Index
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.base import Base


class StockDailyMetric(Base):
    """일배치 사전계산 지표 (스크리닝/추천 DB 조회용)."""
    __tablename__ = "stock_daily_metrics"
    __table_args__ = (
        UniqueConstraint("code", "trade_date", name="uq_metric_code_date"),
        Index("ix_metric_screen", "trade_date", "composite_score"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    trade_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    close: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    ma5: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    ma20: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    ma60: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    ma120: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    ma_alignment: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)  # bullish/bearish/mixed
    golden_cross: Mapped[bool] = mapped_column(Boolean, default=False)
    dead_cross: Mapped[bool] = mapped_column(Boolean, default=False)
    per: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    pbr: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    roe: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    foreign_net: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    institution_net: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    composite_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True, index=True)
    valuation: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    momentum: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    supply: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    phase: Mapped[Optional[str]] = mapped_column(String(12), nullable=True)  # breakout/turnaround/neutral
    return_1m: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    return_3m: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    return_6m: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class ScoreSnapshot(Base):
    """전향적 스냅샷 — 비가격 축 사후검증 보정용 (정답=horizon_return)."""
    __tablename__ = "score_snapshots"
    __table_args__ = (
        UniqueConstraint("code", "snapshot_date", name="uq_snapshot_code_date"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    snapshot_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    momentum: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    supply: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    valuation: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    fundamentals: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # ROE
    composite: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    phase: Mapped[Optional[str]] = mapped_column(String(12), nullable=True)
    entry_price: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    horizon_return: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # 성숙 후 채움(%)
    measured_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
