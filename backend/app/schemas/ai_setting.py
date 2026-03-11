"""Schemas for AI API settings."""
from typing import Optional
from pydantic import BaseModel, field_validator


class AISettingResponse(BaseModel):
    """Response schema for AI API setting.

    api_key is masked: only the last 4 characters are visible,
    prefixed with 'sk-...'. If the stored (decrypted) key is shorter
    than 4 characters the full value is returned as-is.
    """

    id: str
    provider: str
    api_key_masked: str
    is_active: bool

    class Config:
        from_attributes = True


class AISettingUpdate(BaseModel):
    """Request body for creating or updating an AI API setting."""

    provider: str
    api_key: str
    is_active: bool = False

    @field_validator("provider")
    @classmethod
    def provider_must_not_be_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("provider must not be empty")
        return v

    @field_validator("api_key")
    @classmethod
    def api_key_must_not_be_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("api_key must not be empty")
        return v
