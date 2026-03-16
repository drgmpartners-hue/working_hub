"""Pydantic schemas for portfolio suggestions (employee-facing)."""
from pydantic import BaseModel, ConfigDict
from typing import Optional
from datetime import datetime


class SuggestionCreate(BaseModel):
    """Request body for POST /portfolios/suggestions."""
    account_id: str
    snapshot_id: str
    suggested_weights: dict  # {holding_id: weight}
    ai_comment: Optional[str] = None


class SuggestionCreateResponse(BaseModel):
    """Response after creating a suggestion."""
    suggestion_id: str
    portal_link: str
    expires_at: datetime


class SuggestionDetail(BaseModel):
    """Full suggestion detail (employee view)."""
    id: str
    account_id: str
    snapshot_id: str
    suggested_weights: dict
    ai_comment: Optional[str] = None
    expires_at: datetime
    created_at: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)
