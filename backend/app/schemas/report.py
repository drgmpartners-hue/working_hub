"""Pydantic schemas for Portfolio Report API (PF-R3-T1)."""
from __future__ import annotations

from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------

_VALID_PERIODS = Literal["3m", "6m", "1y"]


class PortfolioReportRequest(BaseModel):
    """Request body for POST /api/v1/reports/portfolio."""

    client_id: str
    account_ids: list[str] = Field(default_factory=list)
    snapshot_date: date
    period: _VALID_PERIODS = "3m"


# ---------------------------------------------------------------------------
# Response sub-schemas
# ---------------------------------------------------------------------------


class ReportHolding(BaseModel):
    """Single holding entry in the portfolio report."""

    id: str
    product_name: str
    risk_level: Optional[str] = None
    region: Optional[str] = None
    purchase_amount: Optional[float] = None
    evaluation_amount: Optional[float] = None
    profit_loss: Optional[float] = None
    return_rate: Optional[float] = None
    weight: Optional[float] = None


class ReportHistoryItem(BaseModel):
    """Single history data point for chart rendering."""

    snapshot_id: str
    snapshot_date: str  # ISO date string "YYYY-MM-DD"
    total_evaluation: Optional[float] = None
    total_return_rate: Optional[float] = None
    region_weights: dict[str, float] = Field(default_factory=dict)
    risk_weights: dict[str, float] = Field(default_factory=dict)


class ReportAccount(BaseModel):
    """Report data for a single client account."""

    account_id: str
    account_type: str
    account_number: Optional[str] = None
    securities_company: Optional[str] = None
    snapshot_date: Optional[str] = None
    monthly_payment: Optional[int] = None
    deposit: Optional[float] = None
    principal: Optional[float] = None
    evaluation: Optional[float] = None
    profit: Optional[float] = None
    return_rate: Optional[float] = None
    holdings: list[ReportHolding] = Field(default_factory=list)
    region_distribution: dict[str, float] = Field(default_factory=dict)
    risk_distribution: dict[str, float] = Field(default_factory=dict)
    history: list[ReportHistoryItem] = Field(default_factory=list)
    ai_comment: str = ""


class ReportSummary(BaseModel):
    """Aggregated financial summary across all included accounts."""

    total_evaluation: float = 0.0
    total_principal: float = 0.0
    total_profit: float = 0.0
    total_return_rate: float = 0.0


# ---------------------------------------------------------------------------
# Top-level response schema
# ---------------------------------------------------------------------------


class PortfolioReportResponse(BaseModel):
    """Response for POST /api/v1/reports/portfolio."""

    report_id: str
    client_name: str
    generated_at: datetime
    summary: ReportSummary
    accounts: list[ReportAccount] = Field(default_factory=list)
