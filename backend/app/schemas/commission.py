"""Commission calculation and result schemas."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator


class CommissionCalculationCreate(BaseModel):
    """Payload for creating a new commission calculation.

    - source_file_path: 엑셀 경로. 크롤링 기반 계산은 파일이 없으므로 빈 값 허용.
    - input_data: 선택. employees가 없으면 서버가 source_file_path(엑셀 파싱 결과)
      또는 crawling_job_id(크롤링 결과)에서 자동 도출한다.
    """

    calc_type: str
    source_file_path: str = ""
    input_data: dict[str, Any] = Field(default_factory=dict)

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
