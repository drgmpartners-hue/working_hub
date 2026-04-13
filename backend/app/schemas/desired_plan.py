"""Pydantic schemas for DesiredPlan (은퇴 희망 플랜 - 엑셀 PV/FV 기반 계산)."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field


class DesiredPlanUpsert(BaseModel):
    """PUT 요청 스키마 - 희망 플랜 upsert."""

    # 필수 입력값
    monthly_desired_amount: int = Field(
        ...,
        gt=0,
        description="현재가치 기준 희망 월수령액 (원)",
    )
    retirement_age: int = Field(
        ...,
        ge=40,
        le=100,
        description="희망 은퇴 나이",
    )
    current_age: int = Field(
        ...,
        ge=1,
        le=99,
        description="현재 나이",
    )
    savings_period: int = Field(
        ...,
        ge=1,
        description="월 납입 적립 기간 (년)",
    )
    annual_savings: int = Field(
        ...,
        gt=0,
        description="연 적립 금액 (원)",
    )

    # 선택 입력값 (기본값 있음)
    retirement_period_years: int = Field(
        default=40,
        gt=0,
        description="연금 수령 기간 (년)",
    )
    inflation_rate: Optional[float] = Field(
        default=0.021,
        gt=0,
        le=1.0,
        description="연 물가상승률 (예: 0.021 = 2.1%)",
    )
    pension_return_rate: Optional[float] = Field(
        default=0.05,
        gt=0,
        le=1.0,
        description="은퇴 후 연금 운용 수익률 (예: 0.05 = 5%)",
    )
    expected_return_rate: Optional[float] = Field(
        default=0.07,
        gt=0,
        le=1.0,
        description="적립/거치 기간 예상 수익률 (예: 0.07 = 7%)",
    )
    with_inflation: bool = Field(
        default=False,
        description="목표자금 계산 시 물가상승 반영 여부",
    )

    # 하위 호환 필드 (구 API - 무시됨)
    years_to_retirement: Optional[int] = Field(
        default=None,
        description="[deprecated] retirement_age - current_age 로 자동 계산됨",
    )
    annual_rate: Optional[float] = Field(
        default=None,
        description="[deprecated] expected_return_rate 사용 권장",
    )
    calculation_params: Optional[dict[str, Any]] = Field(
        default=None,
        description="프론트엔드 추가 파라미터 저장용 (JSON)",
    )


class DesiredPlanCalculateRequest(BaseModel):
    """POST /calculate 요청 스키마 - 저장 없이 계산만."""

    monthly_desired_amount: int = Field(..., gt=0)
    retirement_age: int = Field(..., ge=40, le=100)
    current_age: int = Field(..., ge=1, le=99)
    savings_period: int = Field(..., ge=1)
    annual_savings: int = Field(..., gt=0)
    retirement_period_years: int = Field(default=40, gt=0)
    inflation_rate: float = Field(default=0.021, gt=0, le=1.0)
    pension_return_rate: float = Field(default=0.05, gt=0, le=1.0)
    expected_return_rate: float = Field(default=0.07, gt=0, le=1.0)
    with_inflation: bool = Field(default=False)


class SimulationRow(BaseModel):
    """시뮬레이션 테이블 연차 행."""

    year: int
    age: int
    monthly_payment: int
    additional: int
    evaluation: int
    cumulative_principal: int
    investment_return: int


class DesiredPlanCalculateResponse(BaseModel):
    """계산 전용 응답 스키마 (DB 저장 없음)."""

    investment_years: int
    holding_period: int
    future_monthly_amount: int
    target_fund_inflation: int
    target_fund_no_inflation: int
    target_fund: int
    required_holding: int
    required_holding_inflation: int
    required_holding_no_inflation: int
    simulation_table: list[SimulationRow]
    calculation_params: dict[str, Any]


class DesiredPlanResponse(BaseModel):
    """응답 스키마 - 희망 플랜 + 계산 결과."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    profile_id: str

    # 입력값 (필수)
    monthly_desired_amount: int
    retirement_period_years: int

    # 계산 결과 (JSONB calculation_params 에서 복원)
    future_monthly_amount: Optional[int] = None
    target_fund: Optional[int] = None
    target_fund_inflation: Optional[int] = None
    target_fund_no_inflation: Optional[int] = None
    required_holding: Optional[int] = None
    investment_years: Optional[int] = None
    holding_period: Optional[int] = None
    simulation_table: Optional[list[dict[str, Any]]] = None

    # 하위 호환 필드
    target_total_fund: Optional[int] = None
    required_lump_sum: Optional[int] = None
    required_annual_savings: Optional[int] = None

    # 계산 파라미터 (JSON)
    calculation_params: Optional[dict[str, Any]] = None

    created_at: datetime
    updated_at: datetime
