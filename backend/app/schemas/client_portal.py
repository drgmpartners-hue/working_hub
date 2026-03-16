"""Pydantic schemas for client portal authentication and data."""
from pydantic import BaseModel, ConfigDict
from typing import Optional
from datetime import date, datetime


class PortalCheckResponse(BaseModel):
    """Response for GET /client-portal/{token}."""
    exists: bool
    masked_name: Optional[str] = None


class PortalVerifyRequest(BaseModel):
    """Request body for POST /client-portal/{token}/verify."""
    birth_date: date
    phone: str


class PortalTokenResponse(BaseModel):
    """JWT token response after successful verification."""
    access_token: str
    token_type: str = "bearer"


class SnapshotDateEntry(BaseModel):
    """Single account's snapshot dates."""
    account_id: str
    account_type: str
    dates: list[str]  # ISO date strings "YYYY-MM-DD"


class SnapshotsListResponse(BaseModel):
    """Response for GET /client-portal/{token}/snapshots."""
    accounts: list[SnapshotDateEntry]


class SuggestionResponse(BaseModel):
    """Response for GET /client-portal/{token}/suggestion/{suggest_id}."""
    id: str
    account_id: str
    snapshot_id: str
    suggested_weights: dict
    ai_comment: Optional[str] = None
    expires_at: datetime
    created_at: Optional[datetime] = None
    expired: bool
    model_config = ConfigDict(from_attributes=True)


class CallReserveRequest(BaseModel):
    """Request body for POST /client-portal/suggestion/{suggest_id}/call-reserve."""
    preferred_date: date
    preferred_time: str
    client_name: Optional[str] = None
    phone: Optional[str] = None


class CallReserveResponse(BaseModel):
    """Response after successful call reservation."""
    id: str
    suggestion_id: Optional[str] = None
    preferred_date: date
    preferred_time: str
    status: str
    model_config = ConfigDict(from_attributes=True)


class ClientPortalUpdate(BaseModel):
    """PATCH /clients/{id} — update portal-related fields."""
    birth_date: Optional[date] = None
    phone: Optional[str] = None
    email: Optional[str] = None
