"""Content project and content version models."""
from datetime import datetime
from typing import Optional
from sqlalchemy import String, DateTime, ForeignKey, Text, Integer, Boolean
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func
from app.db.base import Base
import uuid


class ContentProject(Base):
    __tablename__ = "content_projects"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    content_type: Mapped[str] = mapped_column(
        String(50), nullable=False, comment="card_news / report / cover_promo"
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    topic: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    content_input: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    brand_setting_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("brand_settings.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    status: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="content_projects")
    brand_setting: Mapped[Optional["BrandSetting"]] = relationship(
        "BrandSetting", back_populates="content_projects"
    )
    versions: Mapped[list["ContentVersion"]] = relationship(
        "ContentVersion", back_populates="project", lazy="select"
    )


class ContentVersion(Base):
    __tablename__ = "content_versions"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    project_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("content_projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    ai_text_content: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    generated_assets: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    file_path: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    is_approved: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    # Relationships
    project: Mapped["ContentProject"] = relationship(
        "ContentProject", back_populates="versions"
    )
