"""Pydantic schemas for Client and ClientAccount."""
from pydantic import BaseModel, ConfigDict
from typing import Optional
from datetime import datetime


class AccountBase(BaseModel):
    account_type: str  # 'irp', 'pension1', 'pension2'
    account_number: Optional[str] = None
    securities_company: Optional[str] = None
    monthly_payment: Optional[int] = None


class AccountCreate(AccountBase):
    pass


class AccountUpdate(BaseModel):
    account_type: Optional[str] = None
    account_number: Optional[str] = None
    securities_company: Optional[str] = None
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
    pass


class ClientUpdate(BaseModel):
    name: Optional[str] = None
    memo: Optional[str] = None


class ClientResponse(ClientBase):
    id: str
    user_id: str
    created_at: datetime
    accounts: list[AccountResponse] = []
    model_config = ConfigDict(from_attributes=True)
