"""Pydantic schemas for wrap account CRUD."""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, field_validator


class WrapAccountCreate(BaseModel):
    """Payload for creating a new wrap account."""

    product_name: str
    securities_company: str
    investment_target: Optional[str] = None
    target_return_rate: Optional[Decimal] = None
    description: Optional[str] = None
    is_active: bool = True

    @field_validator("product_name")
    @classmethod
    def validate_product_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("product_name must not be empty")
        if len(v) > 100:
            raise ValueError("product_name must be 100 characters or fewer")
        return v

    @field_validator("securities_company")
    @classmethod
    def validate_securities_company(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("securities_company must not be empty")
        if len(v) > 50:
            raise ValueError("securities_company must be 50 characters or fewer")
        return v


class WrapAccountUpdate(BaseModel):
    """Payload for partially updating a wrap account."""

    product_name: Optional[str] = None
    securities_company: Optional[str] = None
    investment_target: Optional[str] = None
    target_return_rate: Optional[Decimal] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None

    @field_validator("product_name")
    @classmethod
    def validate_product_name(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip()
        if not v:
            raise ValueError("product_name must not be empty")
        if len(v) > 100:
            raise ValueError("product_name must be 100 characters or fewer")
        return v

    @field_validator("securities_company")
    @classmethod
    def validate_securities_company(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip()
        if not v:
            raise ValueError("securities_company must not be empty")
        if len(v) > 50:
            raise ValueError("securities_company must be 50 characters or fewer")
        return v


class WrapAccountResponse(BaseModel):
    """Response schema for a wrap account record."""

    id: int
    product_name: str
    securities_company: str
    investment_target: Optional[str] = None
    target_return_rate: Optional[Decimal] = None
    description: Optional[str] = None
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
