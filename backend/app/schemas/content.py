"""Content project and content version schemas."""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


VALID_CONTENT_TYPES = {"card_news", "report", "cover_promo"}
VALID_STATUSES = {"draft", "generating", "text_ready", "designing", "completed", "failed"}


class ContentProjectCreate(BaseModel):
    """Schema for creating a new content project."""

    content_type: str = Field(..., description="card_news / report / cover_promo")
    title: str = Field(..., max_length=300)
    topic: Optional[str] = Field(None, max_length=300)
    content_input: Optional[str] = None
    brand_setting_id: Optional[str] = Field(None, max_length=36)


class ContentProjectUpdate(BaseModel):
    """Schema for updating an existing content project. All fields are optional."""

    title: Optional[str] = Field(None, max_length=300)
    topic: Optional[str] = Field(None, max_length=300)
    content_input: Optional[str] = None
    brand_setting_id: Optional[str] = Field(None, max_length=36)
    status: Optional[str] = None


class ContentProjectResponse(BaseModel):
    """Schema for content project response."""

    id: str
    user_id: str
    content_type: str
    title: str
    topic: Optional[str] = None
    content_input: Optional[str] = None
    brand_setting_id: Optional[str] = None
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


class ContentVersionCreate(BaseModel):
    """Schema for creating a new content version (optional text override for regeneration)."""

    ai_text_content: Optional[str] = None


class ContentVersionResponse(BaseModel):
    """Schema for content version response."""

    id: str
    project_id: str
    version_number: int
    ai_text_content: Optional[str] = None
    generated_assets: Optional[dict] = None
    file_path: Optional[str] = None
    is_approved: bool
    created_at: datetime

    model_config = {"from_attributes": True}
