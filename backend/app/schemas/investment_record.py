"""Pydantic schemas for InvestmentRecord."""
from pydantic import BaseModel, ConfigDict, Field, field_validator
from typing import Literal, Optional
from datetime import date, datetime
from decimal import Decimal

RecordType = Literal["investment", "additional_savings", "withdrawal"]
RecordStatus = Literal["ing", "exit", "deposit"]


class InvestmentRecordBase(BaseModel):
    profile_id: str = Field(..., description="은퇴 설계 프로필 ID (UUID)")
    wrap_account_id: Optional[int] = Field(None, description="랩 계좌 ID")
    record_type: RecordType = Field(..., description="기록 유형: investment/additional_savings/withdrawal")
    product_name: Optional[str] = Field(None, max_length=100, description="상품명")
    investment_amount: int = Field(..., description="투자금액 (만원)")
    evaluation_amount: Optional[int] = Field(None, description="평가금액 (만원, exit 시)")
    status: RecordStatus = Field(..., description="상태: ing/exit/deposit")
    start_date: date = Field(..., description="시작일")
    end_date: Optional[date] = Field(None, description="종료일")
    predecessor_id: Optional[int] = Field(None, description="이전 상품 ID (자기참조)")
    successor_id: Optional[int] = Field(None, description="다음 상품 ID (자기참조)")
    memo: Optional[str] = Field(None, description="메모")

    @field_validator("investment_amount")
    @classmethod
    def validate_investment_amount(cls, v: int) -> int:
        if v < 0:
            raise ValueError("investment_amount must be non-negative")
        return v


class InvestmentRecordCreate(InvestmentRecordBase):
    pass


class InvestmentRecordUpdate(BaseModel):
    wrap_account_id: Optional[int] = None
    record_type: Optional[RecordType] = None
    product_name: Optional[str] = Field(None, max_length=100)
    investment_amount: Optional[int] = None
    evaluation_amount: Optional[int] = None
    status: Optional[RecordStatus] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    predecessor_id: Optional[int] = None
    successor_id: Optional[int] = None
    memo: Optional[str] = None

    @field_validator("investment_amount")
    @classmethod
    def validate_investment_amount(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and v < 0:
            raise ValueError("investment_amount must be non-negative")
        return v


class InvestmentRecordResponse(InvestmentRecordBase):
    id: int
    return_rate: Optional[Decimal] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AnnualFlowResponse(BaseModel):
    """연간 투자흐름표 집계 결과."""

    year: int = Field(..., description="대상 연도")
    lump_sum_amount: int = Field(..., description="일시납금액 합계 (만원)")
    annual_savings_amount: int = Field(..., description="연적립금액 합계 (만원)")
    total_payment: int = Field(..., description="총납입금액 (만원)")
    annual_total_profit: int = Field(..., description="연간총수익 (만원)")
    annual_evaluation_amount: int = Field(..., description="연간평가금액 (만원)")
    annual_return_rate: Optional[Decimal] = Field(None, description="연수익률 (%)")
    withdrawal_amount: int = Field(..., description="인출금액 합계 (만원)")

    model_config = ConfigDict(from_attributes=True)
