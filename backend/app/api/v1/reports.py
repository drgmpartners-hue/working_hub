"""Reports API - portfolio report data generation (PF-R3-T1).

PDF rendering is handled by the frontend (window.print / html2canvas).
This router provides structured JSON data for report assembly.
"""
from __future__ import annotations

import logging
from typing import Any, Dict

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.db.session import get_db
from app.schemas.report import PortfolioReportRequest, PortfolioReportResponse
from app.services import report_service

logger = logging.getLogger(__name__)

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


# ---------------------------------------------------------------------------
# AI comment generation (standalone endpoint)
# ---------------------------------------------------------------------------

_NO_API_KEY_MESSAGE = (
    "AI 분석 코멘트를 생성하려면 설정 > AI API에서 Gemini API Key를 등록해주세요."
)


class AiCommentRequest(BaseModel):
    client_name: str | None = None
    account_type: str | None = None
    snapshot_date: str | None = None
    total_evaluation: float | None = None
    total_return_rate: float | None = None
    holdings: list[Dict[str, Any]] | None = None
    comment_type: str | None = "analysis"  # "analysis" or "change"
    holdings_after: list[Dict[str, Any]] | None = None  # 변경 후 포트폴리오 (change용)


class AiCommentResponse(BaseModel):
    comment: str


@router.post("/ai-comment", response_model=AiCommentResponse)
async def generate_ai_comment(
    body: AiCommentRequest,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AiCommentResponse:
    """Generate a standalone AI analysis comment for a single account snapshot.

    Accepts summary figures and holdings from the frontend and returns a
    Korean analysis via Gemini using DB-cached keyword market analyses.
    Returns a guidance message when the Gemini API key is not configured.
    """
    from app.core.config import settings  # noqa: PLC0415

    if not settings.GEMINI_API_KEY:
        return AiCommentResponse(comment=_NO_API_KEY_MESSAGE)

    try:
        from app.services.ai_service import _call_gemini  # noqa: PLC0415
        from app.services.market_analysis_service import (  # noqa: PLC0415
            get_analyses_for_portfolio,
            build_analysis_comment_prompt,
            build_change_comment_prompt,
        )

        holdings = body.holdings or []
        holdings_lines = []
        for h in holdings:
            holdings_lines.append(
                f"- {h.get('product_name', '미상')}: "
                f"위험도={h.get('risk_level', '미설정')}, "
                f"지역={h.get('region', '미설정')}, "
                f"평가금액={h.get('evaluation_amount') or 0:,.0f}원, "
                f"수익률={h.get('return_rate') or 0:.2f}%, "
                f"비중={h.get('weight') or 0:.1f}%"
            )

        product_names = [h.get("product_name", "") for h in holdings]
        regions = [h.get("region", "") for h in holdings]

        # 키워드별 시황 분석 (DB 캐시 우선)
        analyses = await get_analyses_for_portfolio(db, product_names, regions)

        comment_type = body.comment_type or "analysis"

        if comment_type == "change":
            holdings_before = [
                {
                    "name": h.get("product_name", "미상"),
                    "weight": h.get("weight") or 0,
                    "return_rate": h.get("return_rate") or 0,
                }
                for h in holdings
            ]
            holdings_after_raw = body.holdings_after or []
            holdings_after = [
                {
                    "name": h.get("product_name", "미상"),
                    "weight": h.get("weight") or 0,
                }
                for h in holdings_after_raw
            ]
            # 변경 후 포트폴리오 종목도 analyses에 포함
            after_names = [h.get("product_name", "") for h in holdings_after_raw]
            after_regions = [h.get("region", "") for h in holdings_after_raw]
            after_analyses = await get_analyses_for_portfolio(db, after_names, after_regions)
            analyses.update(after_analyses)

            prompt = build_change_comment_prompt(
                client_name=body.client_name or "미상",
                account_type=body.account_type or "미상",
                holdings_before=holdings_before,
                holdings_after=holdings_after,
                analyses=analyses,
            )
        else:
            prompt = build_analysis_comment_prompt(
                client_name=body.client_name or "미상",
                account_type=body.account_type or "미상",
                snapshot_date=body.snapshot_date or "미상",
                total_evaluation=body.total_evaluation or 0,
                total_return_rate=body.total_return_rate or 0,
                holdings_lines=holdings_lines if holdings_lines else ["  (종목 정보 없음)"],
                analyses=analyses,
            )

        comment = _call_gemini(prompt)

        # _call_gemini returns an error string on failure but never raises.
        # Treat obvious failure responses as a fallback message.
        if comment.startswith("[AI 응답 실패"):
            logger.warning("Gemini call returned failure string: %s", comment)
            return AiCommentResponse(comment=_NO_API_KEY_MESSAGE)

        return AiCommentResponse(comment=comment)

    except Exception as exc:
        logger.warning("generate_ai_comment failed: %s", exc)
        return AiCommentResponse(comment=_NO_API_KEY_MESSAGE)
