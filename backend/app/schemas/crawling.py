"""Crawling job schemas."""
from datetime import datetime
from typing import Any, Optional
from pydantic import BaseModel


VALID_SOURCE_TYPES = {
    "securities_commission",
    "irp_portfolio",
}


class CrawlingJobCreate(BaseModel):
    source_type: str

    model_config = {"from_attributes": True}


class CrawlingJobResponse(BaseModel):
    id: str
    source_type: str
    status: str
    result_data: Optional[Any] = None
    error_message: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}
