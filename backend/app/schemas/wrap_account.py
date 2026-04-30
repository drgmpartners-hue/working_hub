"""Pydantic schemas for investment product CRUD."""
from __future__ import annotations
from datetime import datetime
from decimal import Decimal
from typing import Optional
from pydantic import BaseModel, field_validator


class WrapAccountCreate(BaseModel):
    product_name: str
    in_out: Optional[str] = None
    category: Optional[str] = None
    asset_class_1: Optional[str] = None
    asset_class_2: Optional[str] = None
    institution: Optional[str] = None
    period: Optional[str] = None
    risk_level: Optional[str] = None
    currency: Optional[str] = '₩'
    total_expected_return: Optional[Decimal] = None
    annual_expected_return: Optional[Decimal] = None
    port_1: Optional[str] = None
    port_2: Optional[str] = None
    port_3: Optional[str] = None
    port_4: Optional[str] = None
    port_5: Optional[str] = None
    port_6: Optional[str] = None
    port_7: Optional[str] = None
    port_8: Optional[str] = None
    port_9: Optional[str] = None
    port_10: Optional[str] = None
    # Legacy compatibility
    securities_company: Optional[str] = None
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
        return v


class WrapAccountUpdate(BaseModel):
    product_name: Optional[str] = None
    in_out: Optional[str] = None
    category: Optional[str] = None
    asset_class_1: Optional[str] = None
    asset_class_2: Optional[str] = None
    institution: Optional[str] = None
    period: Optional[str] = None
    risk_level: Optional[str] = None
    currency: Optional[str] = None
    total_expected_return: Optional[Decimal] = None
    annual_expected_return: Optional[Decimal] = None
    port_1: Optional[str] = None
    port_2: Optional[str] = None
    port_3: Optional[str] = None
    port_4: Optional[str] = None
    port_5: Optional[str] = None
    port_6: Optional[str] = None
    port_7: Optional[str] = None
    port_8: Optional[str] = None
    port_9: Optional[str] = None
    port_10: Optional[str] = None
    securities_company: Optional[str] = None
    investment_target: Optional[str] = None
    target_return_rate: Optional[Decimal] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None


class WrapAccountResponse(BaseModel):
    id: int
    product_name: str
    in_out: Optional[str] = None
    category: Optional[str] = None
    asset_class_1: Optional[str] = None
    asset_class_2: Optional[str] = None
    institution: Optional[str] = None
    period: Optional[str] = None
    risk_level: Optional[str] = None
    currency: Optional[str] = None
    total_expected_return: Optional[Decimal] = None
    annual_expected_return: Optional[Decimal] = None
    port_1: Optional[str] = None
    port_2: Optional[str] = None
    port_3: Optional[str] = None
    port_4: Optional[str] = None
    port_5: Optional[str] = None
    port_6: Optional[str] = None
    port_7: Optional[str] = None
    port_8: Optional[str] = None
    port_9: Optional[str] = None
    port_10: Optional[str] = None
    securities_company: Optional[str] = None
    investment_target: Optional[str] = None
    target_return_rate: Optional[Decimal] = None
    description: Optional[str] = None
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ProductOptionCreate(BaseModel):
    field_name: str
    option_value: str
    sort_order: int = 0

class ProductOptionResponse(BaseModel):
    id: int
    field_name: str
    option_value: str
    sort_order: int
    model_config = {"from_attributes": True}
