"""Pydantic schemas for DesiredPlan (은퇴 희망 플랜 - 복리 역산 결과)."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field


class DesiredPlanUpsert(BaseModel):
    """PUT 요청 스키마 - 희망 플랜 upsert."""

    monthly_desired_amount: int = Field(
        ...,
        gt=0,
        description="매월 희망 수령액 (원), 양수여야 함",
    )
    retirement_period_years: int = Field(
        ...,
        gt=0,
        description="은퇴 후 수령 기간 (년), 양수여야 함",
    )
    years_to_retirement: Optional[int] = Field(
        None,
        ge=0,
        description="은퇴까지 남은 연수 (년), 0 이상. None이면 current_age와 desired_retirement_age로 계산",
    )
    annual_rate: Optional[float] = Field(
        None,
        gt=0,
        le=1.0,
        description="연 수익률 (예: 0.07 = 7%). None이면 기본값 7% 사용",
    )


class DesiredPlanResponse(BaseModel):
    """응답 스키마 - 희망 플랜 + 계산 결과."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    profile_id: str

    # 입력값
    monthly_desired_amount: int
    retirement_period_years: int

    # 복리 역산 결과
    target_total_fund: Optional[int] = None
    required_lump_sum: Optional[int] = None
    required_annual_savings: Optional[int] = None

    # 계산 파라미터 (JSON)
    calculation_params: Optional[dict[str, Any]] = None

    created_at: datetime
    updated_at: datetime
