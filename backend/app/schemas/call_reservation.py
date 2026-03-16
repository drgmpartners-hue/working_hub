"""Schemas for call reservation management (employee-facing)."""
from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel


class CallReservationListItem(BaseModel):
    id: str
    suggestion_id: Optional[str]
    client_name: Optional[str]
    phone: Optional[str]
    preferred_date: date
    preferred_time: str
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


class CallReservationListResponse(BaseModel):
    items: list[CallReservationListItem]
    total: int


class CallReservationUpdateRequest(BaseModel):
    status: Literal["confirmed", "completed"]


class CallReservationUpdateResponse(BaseModel):
    id: str
    status: str

    model_config = {"from_attributes": True}
