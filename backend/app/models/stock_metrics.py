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


class ThemeMember(Base):
    """테마 → 소속 종목 매핑 (DB 저장, 모든 서버 공유·재배포 영속). 파일 캐시 대체."""
    __tablename__ = "theme_members"
    __table_args__ = (
        UniqueConstraint("theme_name", "code", name="uq_theme_member"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    theme_name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    code: Mapped[str] = mapped_column(String(20), nullable=False)
    name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)


class ThemeDailySnapshot(Base):
    """테마 일별 시세 스냅샷 (네이버 테마 시세) — 흐름/추세 분석용.

    네이버는 당일치만 보여주므로, 매일 1줄씩 쌓아 시계열(흐름)을 만든다.
    가격 데이터(등락률)는 KIS/KRX 없이 네이버 테마 페이지에서 일괄 수집.
    """
    __tablename__ = "theme_daily_snapshots"
    __table_args__ = (
        UniqueConstraint("theme_name", "snapshot_date", name="uq_theme_snap_date"),
        Index("ix_theme_snap", "snapshot_date", "theme_name"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    theme_name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    snapshot_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    change_rate: Mapped[Optional[float]] = mapped_column(Float, nullable=True)   # 전일대비 등락률(%)
    up_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)      # 상승 종목 수
    down_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)    # 하락 종목 수
    news_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)    # 최근 뉴스 건수(관심도)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


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
