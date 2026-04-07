"""Pydantic schemas for CustomerRetirementProfile."""
from pydantic import BaseModel, ConfigDict, Field
from typing import Optional
from datetime import datetime


class CustomerRetirementProfileBase(BaseModel):
    target_retirement_fund: int = Field(..., description="목표 은퇴 자산 (원)")
    desired_pension_amount: int = Field(..., description="원하는 월 연금액 (원)")
    age_at_design: int = Field(..., ge=1, le=120, description="설계 당시 나이")
    current_age: int = Field(..., ge=1, le=120, description="현재 나이")
    desired_retirement_age: int = Field(..., ge=1, le=120, description="희망 은퇴 나이")


class CustomerRetirementProfileCreate(CustomerRetirementProfileBase):
    pass


class CustomerRetirementProfileUpdate(BaseModel):
    target_retirement_fund: Optional[int] = None
    desired_pension_amount: Optional[int] = None
    age_at_design: Optional[int] = Field(None, ge=1, le=120)
    current_age: Optional[int] = Field(None, ge=1, le=120)
    desired_retirement_age: Optional[int] = Field(None, ge=1, le=120)


class CustomerRetirementProfileResponse(CustomerRetirementProfileBase):
    id: str
    customer_id: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
