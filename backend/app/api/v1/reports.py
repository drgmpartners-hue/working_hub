"""Reports API - portfolio report data generation (PF-R3-T1).

PDF rendering is handled by the frontend (window.print / html2canvas).
This router provides structured JSON data for report assembly.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.db.session import get_db
from app.schemas.report import PortfolioReportRequest, PortfolioReportResponse
from app.services import report_service

router = APIRouter(prefix="/reports", tags=["reports"])


@router.post("/portfolio", response_model=PortfolioReportResponse)
async def generate_portfolio_report(
    body: PortfolioReportRequest,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PortfolioReportResponse:
    """Generate a structured portfolio report with AI comments.

    Collects snapshot data, holdings, region/risk distributions, and history
    for each requested account, then calls Gemini to produce a 2-3 sentence
    AI analysis comment per account.

    PDF generation is delegated to the frontend.
    """
    data = await report_service.generate_portfolio_report(
        db=db,
        client_id=body.client_id,
        account_ids=body.account_ids,
        snapshot_date=body.snapshot_date,
        period=body.period,
    )
    return data
