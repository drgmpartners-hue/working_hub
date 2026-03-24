"""Pydantic schemas for PortfolioSnapshot and PortfolioHolding."""
from pydantic import BaseModel, ConfigDict
from typing import Optional, Any
from datetime import datetime, date


class HoldingUpdateRequest(BaseModel):
    """Fields that can be manually updated on a PortfolioHolding record."""
    product_name: Optional[str] = None
    product_code: Optional[str] = None
    product_type: Optional[str] = None
    risk_level: Optional[str] = None
    region: Optional[str] = None
    quantity: Optional[float] = None
    purchase_price: Optional[float] = None
    current_price: Optional[float] = None
    purchase_amount: Optional[float] = None
    evaluation_amount: Optional[float] = None
    total_deposit: Optional[float] = None
    total_withdrawal: Optional[float] = None
    return_amount: Optional[float] = None
    return_rate: Optional[float] = None
    weight: Optional[float] = None
    reference_price: Optional[float] = None


class ApplyMasterResponse(BaseModel):
    """Result of applying product_master data to all holdings in a snapshot."""
    updated: int
    not_found: list[str]


class HoldingResponse(BaseModel):
    id: str
    snapshot_id: str
    product_name: str
    product_code: Optional[str] = None
    product_type: Optional[str] = None
    risk_level: Optional[str] = None
    region: Optional[str] = None
    quantity: Optional[float] = None
    purchase_price: Optional[float] = None
    current_price: Optional[float] = None
    purchase_amount: Optional[float] = None
    evaluation_amount: Optional[float] = None
    total_deposit: Optional[float] = None
    total_withdrawal: Optional[float] = None
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
    foreign_deposit_amount: Optional[float] = None
    total_assets: Optional[float] = None
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


class SnapshotHistoryItem(BaseModel):
    """Single snapshot entry in the history timeline (for chart rendering)."""
    snapshot_id: str
    snapshot_date: date
    total_evaluation: Optional[float] = None
    total_return_rate: Optional[float] = None
    region_weights: dict[str, float] = {}
    risk_weights: dict[str, float] = {}


class SnapshotHistoryResponse(BaseModel):
    """Response for GET /snapshots/history."""
    account_id: str
    period: Optional[str] = None
    items: list[SnapshotHistoryItem] = []
