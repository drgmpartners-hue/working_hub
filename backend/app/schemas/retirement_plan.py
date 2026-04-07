"""Pydantic schemas for RetirementPlan and simulation."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Yearly projection entry (used in response only)
# ---------------------------------------------------------------------------

class YearlyProjection(BaseModel):
    year: int
    year_num: int
    age: int
    lump_sum: int
    annual_savings: int
    total_contribution: int
    annual_return: float
    evaluation: float


# ---------------------------------------------------------------------------
# RetirementPlan schemas
# ---------------------------------------------------------------------------

class RetirementPlanBase(BaseModel):
    profile_id: str = Field(..., description="customer_retirement_profiles.id (UUID)")
    current_age: int = Field(..., ge=1, le=120, description="현재 나이")
    annual_return_rate: float = Field(..., ge=0, le=100, description="연수익률 (%)")
    lump_sum_amount: Optional[int] = Field(None, description="일시납입금액 (만원)")
    annual_savings: Optional[int] = Field(None, description="연적립금액 (만원)")
    saving_period_years: Optional[int] = Field(None, ge=0, description="납입기간 (년)")
    inflation_rate: Optional[float] = Field(None, ge=0, le=100, description="물가상승률 (%)")
    target_retirement_fund: Optional[int] = Field(None, description="목표은퇴자금 (만원)")
    target_pension_amount: Optional[int] = Field(None, description="목표연금액 월 (만원)")
    desired_retirement_age: Optional[int] = Field(None, ge=1, le=120, description="희망은퇴나이")
    possible_retirement_age: Optional[int] = Field(None, ge=1, le=120, description="가능은퇴나이")
    inheritance_consideration: bool = Field(False, description="상속 고려 여부")


class RetirementPlanCreate(RetirementPlanBase):
    pass


class RetirementPlanUpdate(BaseModel):
    current_age: Optional[int] = Field(None, ge=1, le=120)
    annual_return_rate: Optional[float] = Field(None, ge=0, le=100)
    lump_sum_amount: Optional[int] = None
    annual_savings: Optional[int] = None
    saving_period_years: Optional[int] = Field(None, ge=0)
    inflation_rate: Optional[float] = Field(None, ge=0, le=100)
    target_retirement_fund: Optional[int] = None
    target_pension_amount: Optional[int] = None
    desired_retirement_age: Optional[int] = Field(None, ge=1, le=120)
    possible_retirement_age: Optional[int] = Field(None, ge=1, le=120)
    inheritance_consideration: Optional[bool] = None
    yearly_projections: Optional[list[Any]] = None


class RetirementPlanResponse(RetirementPlanBase):
    id: int
    yearly_projections: Optional[list[Any]] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Simulation schemas
# ---------------------------------------------------------------------------

class SimulationInput(BaseModel):
    current_age: int = Field(..., ge=1, le=120, description="현재 나이")
    annual_return_rate: float = Field(..., ge=0, le=100, description="연수익률 (%)")
    lump_sum_amount: Optional[float] = Field(0, description="일시납입금액 (만원)")
    annual_savings: Optional[float] = Field(0, description="연적립금액 (만원)")
    saving_period_years: Optional[int] = Field(0, ge=0, description="납입기간 (년)")
    target_pension_amount: Optional[float] = Field(0, description="목표연금액 월 (만원)")


class SimulationResult(BaseModel):
    yearly_projections: list[YearlyProjection]
