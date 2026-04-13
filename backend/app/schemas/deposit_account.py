"""Pydantic schemas for deposit accounts and transactions."""
from __future__ import annotations

from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Transaction type literal
# ---------------------------------------------------------------------------

TransactionType = Literal[
    "investment", "termination", "deposit", "withdrawal", "interest", "other"
]

# ---------------------------------------------------------------------------
# DepositAccount schemas
# ---------------------------------------------------------------------------


class DepositAccountCreate(BaseModel):
    profile_id: Optional[str] = Field(None, description="customer_retirement_profiles.id (자동 설정)")
    customer_id: str = Field(..., description="고객 ID")
    securities_company: str = Field(..., description="증권사명")
    account_number: Optional[str] = Field(None, description="계좌번호")
    nickname: Optional[str] = Field(None, description="계좌 별명")


class DepositAccountUpdate(BaseModel):
    securities_company: Optional[str] = None
    account_number: Optional[str] = None
    nickname: Optional[str] = None
    is_active: Optional[bool] = None


class DepositAccountResponse(BaseModel):
    id: int
    profile_id: str
    customer_id: str
    securities_company: str
    account_number: Optional[str] = None
    nickname: Optional[str] = None
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# DepositTransaction schemas
# ---------------------------------------------------------------------------


class DepositTransactionCreate(BaseModel):
    transaction_date: date = Field(..., description="이벤트 발생일")
    transaction_type: TransactionType = Field(..., description="거래 유형")
    related_product: Optional[str] = Field(None, description="관련 상품명")
    investment_record_id: Optional[int] = Field(None, description="관련 투자기록 ID")
    credit_amount: int = Field(0, ge=0, description="입금액 (원)")
    debit_amount: int = Field(0, ge=0, description="출금액 (원)")
    memo: Optional[str] = Field(None, description="메모")


class DepositTransactionUpdate(BaseModel):
    transaction_date: Optional[date] = None
    transaction_type: Optional[TransactionType] = None
    related_product: Optional[str] = None
    investment_record_id: Optional[int] = None
    credit_amount: Optional[int] = Field(None, ge=0)
    debit_amount: Optional[int] = Field(None, ge=0)
    memo: Optional[str] = None


class DepositTransactionResponse(BaseModel):
    id: int
    deposit_account_id: int
    transaction_date: date
    transaction_type: str
    related_product: Optional[str] = None
    investment_record_id: Optional[int] = None
    credit_amount: int
    debit_amount: int
    balance: int
    memo: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
