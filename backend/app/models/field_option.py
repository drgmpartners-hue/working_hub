"""FieldOption model - user-customizable dropdown options for account fields."""
import uuid
from datetime import datetime
from sqlalchemy import String, Integer, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func
from app.db.base import Base


class FieldOption(Base):
    """Stores user-defined dropdown options for fields like 증권사, 계좌유형, 투권인."""
    __tablename__ = "field_options"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    field_name: Mapped[str] = mapped_column(String(50), nullable=False, index=True)  # 'securities', 'account_type', 'representative'
    value: Mapped[str] = mapped_column(String(100), nullable=False)  # stored value
    label: Mapped[str] = mapped_column(String(100), nullable=False)  # display label
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
