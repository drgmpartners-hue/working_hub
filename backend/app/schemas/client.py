"""Pydantic schemas for Client and ClientAccount."""
from pydantic import BaseModel, ConfigDict
from typing import Optional
from datetime import datetime, date


class AccountBase(BaseModel):
    account_type: str  # 'irp', 'pension', 'pension_hold', 'retirement', 'stock', 'other'
    account_number: Optional[str] = None
    securities_company: Optional[str] = None
    representative: Optional[str] = None  # 투권인
    monthly_payment: Optional[int] = None


class AccountCreate(AccountBase):
    pass


class AccountUpdate(BaseModel):
    account_type: Optional[str] = None
    account_number: Optional[str] = None
    securities_company: Optional[str] = None
    representative: Optional[str] = None  # 투권인
    monthly_payment: Optional[int] = None


class AccountResponse(AccountBase):
    id: str
    client_id: str
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class ClientBase(BaseModel):
    name: str
    memo: Optional[str] = None


class ClientCreate(ClientBase):
    birth_date: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    ssn: Optional[str] = None  # 평문 주민번호 (저장 시 암호화, 응답에는 포함 안 됨)


class ClientUpdate(BaseModel):
    name: Optional[str] = None
    memo: Optional[str] = None
    ssn: Optional[str] = None  # 평문 주민번호 (저장 시 암호화, 응답에는 포함 안 됨)


class ClientResponse(ClientBase):
    id: str
    user_id: str
    created_at: datetime
    accounts: list[AccountResponse] = []
    birth_date: Optional[date] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    portal_token: Optional[str] = None
    unique_code: Optional[str] = None
    ssn_masked: Optional[str] = None  # 마스킹된 주민번호 (복호화 후 마스킹)
    model_config = ConfigDict(from_attributes=True)
