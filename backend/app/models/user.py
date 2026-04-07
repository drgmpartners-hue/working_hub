"""User model for authentication."""
from datetime import datetime
from typing import Optional, TYPE_CHECKING
from sqlalchemy import String, Boolean, DateTime
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func
from app.db.base import Base
import uuid

if TYPE_CHECKING:
    from app.models.customer_retirement_profile import CustomerRetirementProfile


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    nickname: Mapped[str] = mapped_column(String(50), nullable=False)
    phone: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    profile_image: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_superuser: Mapped[bool] = mapped_column(Boolean, default=False)
    last_login: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Relationships
    commission_calculations: Mapped[list["CommissionCalculation"]] = relationship(
        "CommissionCalculation", back_populates="user", lazy="select"
    )
    portfolio_analyses: Mapped[list["PortfolioAnalysis"]] = relationship(
        "PortfolioAnalysis", back_populates="user", lazy="select"
    )
    stock_recommendations: Mapped[list["StockRecommendation"]] = relationship(
        "StockRecommendation", back_populates="user", lazy="select"
    )
    content_projects: Mapped[list["ContentProject"]] = relationship(
        "ContentProject", back_populates="user", lazy="select"
    )
    clients: Mapped[list["Client"]] = relationship(
        "Client", back_populates="user", lazy="select"
    )
    retirement_profile: Mapped[Optional["CustomerRetirementProfile"]] = relationship(
        "CustomerRetirementProfile", back_populates="customer", uselist=False, lazy="select"
    )
