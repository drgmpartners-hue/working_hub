"""Dr.GM 추천 포트폴리오 - 전 고객 공통 추천 포트폴리오 템플릿.

포트폴리오(탭)를 여러 개 두고 각각 상품 목록을 갖는다.
연금저축용 펀드와 IRP용 펀드처럼 계좌 종류별로 구성이 달라지는 경우를
탭으로 나눠 미리 저장해 두고 꺼내 쓰기 위한 구조.
"""
import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import String, DateTime, Float, Integer, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func
from app.db.base import Base

# 탭 개수 상한 — UI가 바인더 탭 형태라 한 줄에 들어가는 수로 제한한다
MAX_PORTFOLIOS = 5


class RecommendedPortfolio(Base):
    """추천 포트폴리오 탭 하나."""

    __tablename__ = "recommended_portfolios"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    seq: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # 탭을 열었을 때 기본으로 보여줄 비중 (연금저축 / IRP)
    account_type: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    # 비중 → 금액 환산에 쓰는 입력값. 탭별로 기억한다
    monthly_amount: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    lump_sum_amount: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )


class RecommendedPortfolioItem(Base):
    __tablename__ = "recommended_portfolio_items"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    # 기존 데이터 이관을 위해 nullable — 마이그레이션에서 기본 탭으로 채운다
    portfolio_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("recommended_portfolios.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    product_name: Mapped[str] = mapped_column(String(300), nullable=False)
    product_code: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    product_type: Mapped[Optional[str]] = mapped_column(
        String(100), nullable=True
    )  # ETF/펀드/MMF 등
    region: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    current_price: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    # 투자비중 0.0~1.0 — 계좌 종류별 구분은 탭으로 대체되어 비중은 하나만 쓴다
    weight: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    # 아래 둘은 탭 도입 이전의 연금저축/IRP 분리 비중. 더 이상 쓰지 않으며
    # 과거 데이터 확인용으로만 남겨 둔다 (마이그레이션에서 weight로 이관 완료)
    weight_pension: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    weight_irp: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    memo: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    seq: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )
