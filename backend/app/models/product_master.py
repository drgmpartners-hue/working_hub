"""ProductMaster ORM model — 상품명 ↔ 위험도/지역 마스터 테이블."""
import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import String, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func
from app.db.base import Base


class ProductMaster(Base):
    __tablename__ = "product_master"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    product_name: Mapped[str] = mapped_column(
        String(300), nullable=False, unique=True, index=True
    )
    product_code: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    risk_level: Mapped[Optional[str]] = mapped_column(
        String(50), nullable=True
    )  # 절대안정형/안정형/성장형/절대성장형
    region: Mapped[Optional[str]] = mapped_column(
        String(50), nullable=True
    )  # 국내/미국/글로벌/베트남/인도/중국/기타
    product_type: Mapped[Optional[str]] = mapped_column(
        String(100), nullable=True
    )  # ETF/펀드/MMF 등
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )
