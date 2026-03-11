"""Stock theme, recommendation, recommended stock, and company stock pool schemas."""
from datetime import datetime
from typing import Any, Optional
from pydantic import BaseModel


class StockThemeResponse(BaseModel):
    id: str
    theme_name: str
    ai_score: Optional[float] = None
    news_summary: Optional[str] = None
    stock_count: int
    updated_at: datetime

    model_config = {"from_attributes": True}


class StockThemeAnalyzeRequest(BaseModel):
    theme_ids: list[str]

    model_config = {"from_attributes": True}


class StockRecommendationCreate(BaseModel):
    selected_themes: dict[str, Any]

    model_config = {"from_attributes": True}


class StockRecommendationResponse(BaseModel):
    id: str
    user_id: str
    selected_themes: dict[str, Any]
    ai_scores: Optional[dict[str, Any]] = None
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


class RecommendedStockResponse(BaseModel):
    id: str
    recommendation_id: str
    stock_code: str
    stock_name: str
    theme: str
    rank: int
    return_1m: Optional[float] = None
    return_3m: Optional[float] = None
    return_6m: Optional[float] = None
    institutional_buy: Optional[float] = None
    foreign_buy: Optional[float] = None
    is_top5: bool
    analysis_report: Optional[str] = None

    model_config = {"from_attributes": True}


class CompanyStockPoolCreate(BaseModel):
    pool_name: str
    stocks: dict[str, Any]

    model_config = {"from_attributes": True}


class CompanyStockPoolResponse(BaseModel):
    id: str
    pool_name: str
    stocks: dict[str, Any]
    created_at: datetime

    model_config = {"from_attributes": True}
