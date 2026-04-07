"""Pydantic schemas for pension_plans API."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, field_validator

PensionType = Literal["lifetime", "fixed", "inheritance"]


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------


class PensionCalculateRequest(BaseModel):
    """POST /retirement/pension/calculate 요청 바디."""

    customer_id: str
    pension_type: PensionType

    @field_validator("pension_type")
    @classmethod
    def validate_pension_type(cls, v: str) -> str:
        allowed = ("lifetime", "fixed", "inheritance")
        if v not in allowed:
            raise ValueError(f"pension_type must be one of {allowed}, got '{v}'")
        return v


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------


class PensionPlanResponse(BaseModel):
    """연금 계획 응답 스키마."""

    id: int
    profile_id: str
    pension_type: str
    accumulation_summary: Optional[Any] = None
    distribution_plan: Optional[list[dict]] = None
    combined_graph_data: Optional[list[dict]] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Update schema
# ---------------------------------------------------------------------------


class PensionPlanUpdate(BaseModel):
    """PUT /retirement/pension/{id} 요청 바디 (부분 수정 허용)."""

    pension_type: Optional[PensionType] = None
    accumulation_summary: Optional[Any] = None
    distribution_plan: Optional[list[dict]] = None
    combined_graph_data: Optional[list[dict]] = None
