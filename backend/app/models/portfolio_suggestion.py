"""PortfolioSuggestion ORM model."""
import uuid
from datetime import datetime
from typing import Optional, Any, TYPE_CHECKING
from sqlalchemy import String, Text, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
from app.db.base import Base

if TYPE_CHECKING:
    from app.models.call_reservation import CallReservation


class PortfolioSuggestion(Base):
    __tablename__ = "portfolio_suggestions"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    account_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("client_accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    snapshot_id: Mapped[str] = mapped_column(String(36), nullable=False)
    suggested_weights: Mapped[Any] = mapped_column(JSONB, nullable=False)
    ai_comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    manager_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_by: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime, server_default=func.now(), nullable=True
    )

    # Relationships
    reservations: Mapped[list["CallReservation"]] = relationship(
        "CallReservation", back_populates="suggestion", cascade="all, delete-orphan"
    )
