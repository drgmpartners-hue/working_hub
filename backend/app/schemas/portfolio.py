"""Portfolio analysis and portfolio item schemas."""
from datetime import datetime
from typing import Any, Optional
from pydantic import BaseModel


class PortfolioAnalysisCreate(BaseModel):
    data_source: str
    raw_data: dict[str, Any]

    model_config = {"from_attributes": True}


class PortfolioAnalysisUpdate(BaseModel):
    template_data: Optional[dict[str, Any]] = None
    ai_analysis: Optional[dict[str, Any]] = None
    rebalancing_suggestions: Optional[dict[str, Any]] = None
    report_file_path: Optional[str] = None
    status: Optional[str] = None

    model_config = {"from_attributes": True}


class PortfolioItemUpdate(BaseModel):
    product_name: Optional[str] = None
    product_type: Optional[str] = None
    current_value: Optional[float] = None
    return_rate: Optional[float] = None
    details: Optional[dict[str, Any]] = None

    model_config = {"from_attributes": True}


class PortfolioItemResponse(BaseModel):
    id: str
    analysis_id: str
    product_name: str
    product_type: str
    current_value: float
    return_rate: float
    details: Optional[dict[str, Any]] = None

    model_config = {"from_attributes": True}


class PortfolioAnalysisResponse(BaseModel):
    id: str
    user_id: str
    data_source: str
    raw_data: dict[str, Any]
    template_data: Optional[dict[str, Any]] = None
    ai_analysis: Optional[dict[str, Any]] = None
    rebalancing_suggestions: Optional[dict[str, Any]] = None
    report_file_path: Optional[str] = None
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}
