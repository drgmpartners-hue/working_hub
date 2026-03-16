"""Pydantic schemas for ProductMaster."""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class ProductMasterCreate(BaseModel):
    product_name: str = Field(..., max_length=300)
    product_code: Optional[str] = Field(None, max_length=50)
    risk_level: Optional[str] = Field(None, max_length=50)
    region: Optional[str] = Field(None, max_length=50)
    product_type: Optional[str] = Field(None, max_length=100)


class ProductMasterUpdate(BaseModel):
    product_name: Optional[str] = Field(None, max_length=300)
    product_code: Optional[str] = Field(None, max_length=50)
    risk_level: Optional[str] = Field(None, max_length=50)
    region: Optional[str] = Field(None, max_length=50)
    product_type: Optional[str] = Field(None, max_length=100)


class ProductMasterResponse(BaseModel):
    id: str
    product_name: str
    product_code: Optional[str] = None
    risk_level: Optional[str] = None
    region: Optional[str] = None
    product_type: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class ProductMasterLookupResponse(BaseModel):
    """이름으로 위험도/지역 조회 결과 — 홀딩 매핑용."""
    id: str
    product_name: str
    product_code: Optional[str] = None
    risk_level: Optional[str] = None
    region: Optional[str] = None
    product_type: Optional[str] = None

    model_config = {"from_attributes": True}
