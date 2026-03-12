"""Pydantic schemas for PortfolioSnapshot and PortfolioHolding."""
from pydantic import BaseModel, ConfigDict
from typing import Optional, Any
from datetime import datetime, date


class HoldingResponse(BaseModel):
    id: str
    snapshot_id: str
    product_name: str
    product_code: Optional[str] = None
    product_type: Optional[str] = None
    risk_level: Optional[str] = None
    region: Optional[str] = None
    purchase_amount: Optional[float] = None
    evaluation_amount: Optional[float] = None
    return_amount: Optional[float] = None
    return_rate: Optional[float] = None
    weight: Optional[float] = None
    reference_price: Optional[float] = None
    seq: Optional[int] = None
    model_config = ConfigDict(from_attributes=True)


class SnapshotResponse(BaseModel):
    id: str
    client_account_id: str
    snapshot_date: date
    image_path: Optional[str] = None
    parsed_data: Optional[Any] = None
    deposit_amount: Optional[float] = None
    total_purchase: Optional[float] = None
    total_evaluation: Optional[float] = None
    total_return: Optional[float] = None
    total_return_rate: Optional[float] = None
    created_at: datetime
    holdings: list[HoldingResponse] = []
    model_config = ConfigDict(from_attributes=True)


class SnapshotListItem(BaseModel):
    id: str
    client_account_id: str
    snapshot_date: date
    total_evaluation: Optional[float] = None
    total_return_rate: Optional[float] = None
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)
