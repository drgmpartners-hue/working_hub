"""WrapAccount model — investment product catalog."""
from datetime import datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import Boolean, DateTime, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.base import Base


class WrapAccount(Base):
    """Investment product information."""

    __tablename__ = "wrap_accounts"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    product_name: Mapped[str] = mapped_column(String(200), nullable=False)

    # 기존 필드 (매핑 유지)
    securities_company: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)  # → 거래기관
    investment_target: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)    # 기존 호환
    target_return_rate: Mapped[Optional[Decimal]] = mapped_column(Numeric(5, 2), nullable=True)  # → 연기대수익률
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # 신규 필드
    in_out: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)        # In / Out
    category: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)      # 카테고리
    asset_class_1: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)  # 자산구분(1)
    asset_class_2: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)  # 자산구분(2)
    institution: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)   # 거래기관 (신규)
    period: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)         # 기간
    risk_level: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)     # 투자위험
    currency: Mapped[Optional[str]] = mapped_column(String(5), nullable=True, default='₩')  # 화폐
    total_expected_return: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2), nullable=True)  # 총 기대수익률
    annual_expected_return: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2), nullable=True)  # 연기대수익률

    # 포트(1~10) — 조합 투자대상 회사
    port_1: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    port_2: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    port_3: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    port_4: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    port_5: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    port_6: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    port_7: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    port_8: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    port_9: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    port_10: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )


class ProductSelectOption(Base):
    """Reusable select options for product fields (카테고리, 자산구분, 거래기관, 투자대상회사)."""

    __tablename__ = "product_select_options"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    field_name: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    # field_name: category, asset_class_1, asset_class_2, institution, port_company
    option_value: Mapped[str] = mapped_column(String(100), nullable=False)
    sort_order: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
