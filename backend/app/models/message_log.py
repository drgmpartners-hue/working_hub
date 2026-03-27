"""Message log model — stores SMS/link sending history per client account."""
from datetime import datetime
from typing import Optional
from sqlalchemy import String, DateTime, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func
from app.db.base import Base
import uuid


class MessageLog(Base):
    __tablename__ = "message_logs"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    client_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    client_account_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("client_accounts.id", ondelete="SET NULL"), nullable=True, index=True
    )
    message_type: Mapped[str] = mapped_column(
        String(30), nullable=False
    )  # 'sms', 'portal_link', 'suggestion_link'
    message_summary: Mapped[str] = mapped_column(
        String(200), nullable=False
    )
    message_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    image_path: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    sent_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
