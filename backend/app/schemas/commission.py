"""Commission calculation and result schemas."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, field_validator


class CommissionCalculationCreate(BaseModel):
    """Payload for creating a new commission calculation."""

    calc_type: str
    source_file_path: str
    input_data: dict[str, Any]

    @field_validator("calc_type")
    @classmethod
    def validate_calc_type(cls, v: str) -> str:
        allowed = {"dr_gm", "securities"}
        if v not in allowed:
            raise ValueError(f"calc_type must be one of {sorted(allowed)}")
        return v

    @field_validator("source_file_path")
    @classmethod
    def validate_source_file_path(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("source_file_path must not be empty")
        return v.strip()


class CommissionCalculationResponse(BaseModel):
    """Response schema for a commission calculation record."""

    id: str
    user_id: str
    calc_type: str
    source_file_path: str
    input_data: Optional[Any] = None
    result_data: Optional[Any] = None
    status: str
    created_at: datetime

    class Config:
        from_attributes = True


class CommissionCalculationList(BaseModel):
    """Paginated list of commission calculations."""

    items: list[CommissionCalculationResponse]
    total: int


class CommissionResultResponse(BaseModel):
    """Response schema for a single commission result record."""

    id: str
    calculation_id: str
    employee_name: str
    detail_data: Optional[Any] = None
    report_file_path: Optional[str] = None

    class Config:
        from_attributes = True


class CommissionResultList(BaseModel):
    """List of commission results for a calculation."""

    items: list[CommissionResultResponse]
    total: int
