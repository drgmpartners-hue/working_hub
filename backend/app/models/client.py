"""Client and ClientAccount ORM models for IRP/pension portfolio management."""
import uuid
from datetime import datetime, date
from typing import Optional, TYPE_CHECKING
from sqlalchemy import String, Text, Integer, DateTime, Date, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func
from app.db.base import Base

if TYPE_CHECKING:
    from app.models.user import User
    from app.models.snapshot import PortfolioSnapshot


class Client(Base):
    __tablename__ = "clients"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    memo: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    birth_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    phone: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    email: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    portal_token: Mapped[Optional[str]] = mapped_column(
        String(36), nullable=True, unique=True, default=lambda: str(uuid.uuid4())
    )
    # 고유번호 (6자리 숫자, 중복 불가)
    unique_code: Mapped[Optional[str]] = mapped_column(
        String(6), nullable=True, unique=True, index=True
    )
    # 주민번호 (AES 암호화 저장)
    ssn_encrypted: Mapped[Optional[str]] = mapped_column(
        String(500), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="clients")
    accounts: Mapped[list["ClientAccount"]] = relationship(
        "ClientAccount", back_populates="client", cascade="all, delete-orphan"
    )


class ClientAccount(Base):
    __tablename__ = "client_accounts"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    client_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    account_type: Mapped[str] = mapped_column(String(20), nullable=False)  # 'irp', 'pension', 'pension_hold', 'retirement', 'stock', 'other'
    account_number: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    securities_company: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    representative: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)  # 투권인
    monthly_payment: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    # Relationships
    client: Mapped["Client"] = relationship("Client", back_populates="accounts")
    snapshots: Mapped[list["PortfolioSnapshot"]] = relationship(
        "PortfolioSnapshot", back_populates="account", cascade="all, delete-orphan"
    )
