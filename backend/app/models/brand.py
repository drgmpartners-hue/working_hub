"""Brand settings model."""
from typing import Optional
from sqlalchemy import String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
import uuid


class BrandSetting(Base):
    __tablename__ = "brand_settings"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    company_name: Mapped[str] = mapped_column(String(200), nullable=False)
    primary_color: Mapped[str] = mapped_column(String(20), nullable=False)
    secondary_color: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    logo_path: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    font_family: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    style_config: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)

    # Relationships
    content_projects: Mapped[list["ContentProject"]] = relationship(
        "ContentProject", back_populates="brand_setting", lazy="select"
    )
