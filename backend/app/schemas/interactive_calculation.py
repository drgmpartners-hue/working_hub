"""Pydantic schemas for interactive calculations."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Request schema
# ---------------------------------------------------------------------------

class InteractiveCalcRequest(BaseModel):
    """인터랙티브 계산 실행 요청 스키마."""

    customer_id: str = Field(..., description="고객 UUID (users.id)")
    plan_year: int = Field(..., ge=1900, le=2200, description="계산 기준 연도")


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------

class ActualDataEntry(BaseModel):
    """실제 데이터 항목 (연도별)."""

    year: int
    age: Optional[int] = None
    year_num: Optional[int] = None
    actual_evaluation: float
    planned_evaluation: float
    deviation_rate: Optional[float] = None
    lump_sum_amount: int = 0
    annual_savings_amount: int = 0
    total_payment: int = 0
    annual_total_profit: int = 0
    annual_return_rate: Optional[float] = None
    withdrawal_amount: int = 0


class ProjectedDataEntry(BaseModel):
    """수정 예측 데이터 항목 (연도별)."""

    year: int
    age: Optional[int] = None
    year_num: Optional[int] = None
    evaluation: float
    original_planned_evaluation: float = 0.0


class InteractiveCalcResponse(BaseModel):
    """인터랙티브 계산 결과 응답 스키마."""

    id: int
    profile_id: str
    plan_year: int
    actual_data: Optional[list[Any]] = None
    projected_data: Optional[list[Any]] = None
    deviation_rate: Optional[float] = None
    ai_guide_result: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)
