"""ProductNameChange ORM model — 상품명 변경 메모 (키워드 매핑)."""
import uuid
from datetime import datetime
from sqlalchemy import String, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func
from app.db.base import Base


class ProductNameChange(Base):
    __tablename__ = "product_name_changes"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    old_keyword: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    new_keyword: Mapped[str] = mapped_column(String(200), nullable=False)
    memo: Mapped[str] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )
