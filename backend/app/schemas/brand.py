"""Brand settings schemas."""
from typing import Optional
from pydantic import BaseModel, Field


class BrandSettingResponse(BaseModel):
    """Schema for brand setting response."""
    id: str
    company_name: str
    primary_color: str
    secondary_color: Optional[str] = None
    logo_path: Optional[str] = None
    font_family: Optional[str] = None
    style_config: Optional[dict] = None

    class Config:
        from_attributes = True


class BrandSettingUpdate(BaseModel):
    """Schema for updating brand settings. All fields are optional."""
    company_name: Optional[str] = Field(None, max_length=200)
    primary_color: Optional[str] = Field(None, max_length=20)
    secondary_color: Optional[str] = Field(None, max_length=20)
    logo_path: Optional[str] = Field(None, max_length=500)
    font_family: Optional[str] = Field(None, max_length=100)
    style_config: Optional[dict] = None
