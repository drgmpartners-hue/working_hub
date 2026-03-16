"""CallReservation ORM model."""
import uuid
from datetime import datetime, date
from typing import Optional, TYPE_CHECKING
from sqlalchemy import String, Date, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func
from app.db.base import Base

if TYPE_CHECKING:
    from app.models.portfolio_suggestion import PortfolioSuggestion


class CallReservation(Base):
    __tablename__ = "call_reservations"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    suggestion_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("portfolio_suggestions.id", ondelete="SET NULL"), nullable=True
    )
    client_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    phone: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    preferred_date: Mapped[date] = mapped_column(Date, nullable=False)
    preferred_time: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[Optional[str]] = mapped_column(String(20), nullable=True, default="pending")
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime, server_default=func.now(), nullable=True
    )

    # Relationships
    suggestion: Mapped[Optional["PortfolioSuggestion"]] = relationship(
        "PortfolioSuggestion", back_populates="reservations"
    )
