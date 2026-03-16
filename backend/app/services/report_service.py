"""Report service - portfolio report data assembly and AI comment generation (PF-R3-T1).

This service collects structured JSON data for a portfolio report.
PDF rendering is handled by the frontend (window.print / html2canvas).
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, date
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_

from app.models.client import Client, ClientAccount
from app.models.snapshot import PortfolioSnapshot, PortfolioHolding
from app.services.snapshot_service import get_history_with_weights

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# AI comment generation
# ---------------------------------------------------------------------------


def _generate_ai_comment(account_data: dict) -> str:
    """Generate a 2-3 sentence portfolio analysis comment via Gemini.

    Returns an empty string when the API key is missing or the call fails,
    so that the rest of the report is unaffected.
    """
    try:
        from app.services.ai_service import _call_gemini  # noqa: PLC0415

        holdings_summary = []
        for h in account_data.get("holdings", []):
            holdings_summary.append(
                f"- {h['product_name']}: 위험도={h.get('risk_level', '미설정')}, "
                f"지역={h.get('region', '미설정')}, "
                f"평가금액={h.get('evaluation_amount', 0):,.0f}원, "
                f"수익률={h.get('return_rate', 0):.2f}%"
            )

        region_dist = account_data.get("region_distribution", {})
        risk_dist = account_data.get("risk_distribution", {})

        prompt = (
            "당신은 IRP/연금저축 포트폴리오 전문 자산관리사입니다.\n\n"
            f"계좌 유형: {account_data.get('account_type', '미상')}\n"
            f"총 납입원금: {account_data.get('principal', 0):,.0f}원\n"
            f"총 평가금액: {account_data.get('evaluation', 0):,.0f}원\n"
            f"총 수익률: {account_data.get('return_rate', 0):.2f}%\n\n"
            f"지역 분산:\n"
            + "\n".join(f"  {k}: {v*100:.1f}%" for k, v in region_dist.items())
            + f"\n\n위험도 분산:\n"
            + "\n".join(f"  {k}: {v*100:.1f}%" for k, v in risk_dist.items())
            + f"\n\n보유 종목:\n"
            + "\n".join(holdings_summary)
            + "\n\n위 포트폴리오를 분석하여 2-3문장의 간결한 코멘트를 한국어로 작성해주세요. "
            "핵심 특징과 투자 성향에 대한 평가를 포함하세요."
        )

        return _call_gemini(prompt)

    except Exception as exc:
        logger.warning("AI comment generation failed: %s", exc)
        return ""


# ---------------------------------------------------------------------------
# Data assembly helpers
# ---------------------------------------------------------------------------


def _compute_distributions(holdings: list[PortfolioHolding]) -> tuple[dict, dict]:
    """Return (region_distribution, risk_distribution) as weight dicts (0.0-1.0)."""
    region_totals: dict[str, float] = {}
    risk_totals: dict[str, float] = {}
    grand_total = 0.0

    for h in holdings:
        amt = h.evaluation_amount or 0.0
        grand_total += amt
        if h.region:
            region_totals[h.region] = region_totals.get(h.region, 0.0) + amt
        if h.risk_level:
            risk_totals[h.risk_level] = risk_totals.get(h.risk_level, 0.0) + amt

    if grand_total > 0:
        region_dist = {k: round(v / grand_total, 4) for k, v in region_totals.items()}
        risk_dist = {k: round(v / grand_total, 4) for k, v in risk_totals.items()}
    else:
        region_dist = {}
        risk_dist = {}

    return region_dist, risk_dist


def _holding_to_dict(h: PortfolioHolding) -> dict:
    """Convert a PortfolioHolding ORM instance to a report dict."""
    profit_loss = None
    if h.evaluation_amount is not None and h.purchase_amount is not None:
        profit_loss = h.evaluation_amount - h.purchase_amount

    return {
        "id": h.id,
        "product_name": h.product_name,
        "risk_level": h.risk_level,
        "region": h.region,
        "purchase_amount": h.purchase_amount,
        "evaluation_amount": h.evaluation_amount,
        "profit_loss": profit_loss,
        "return_rate": h.return_rate,
        "weight": h.weight,
    }


# ---------------------------------------------------------------------------
# Main service function
# ---------------------------------------------------------------------------


async def generate_portfolio_report(
    db: AsyncSession,
    client_id: str,
    account_ids: list[str],
    snapshot_date: date,
    period: str = "3m",
) -> dict:
    """Assemble a full portfolio report dict for the given client and accounts.

    Parameters
    ----------
    db:
        Async database session.
    client_id:
        UUID of the client (used to fetch the client name).
    account_ids:
        List of ClientAccount IDs to include in the report.
        Empty list is allowed — results in an empty accounts section.
    snapshot_date:
        The reference date; the snapshot closest to (or on) this date is used.
    period:
        History window: "3m", "6m", or "1y".

    Returns
    -------
    A dict matching the PortfolioReportResponse schema.
    """
    # --- Fetch client name ---------------------------------------------------
    client_result = await db.execute(
        select(Client).where(Client.id == client_id)
    )
    client = client_result.scalar_one_or_none()
    client_name = client.name if client else "알 수 없음"

    # --- Process each account ------------------------------------------------
    accounts_data: list[dict] = []
    total_evaluation = 0.0
    total_principal = 0.0
    total_profit = 0.0

    for account_id in account_ids:
        account_data = await _build_account_report(
            db, account_id, snapshot_date, period
        )
        if account_data is not None:
            accounts_data.append(account_data)
            total_evaluation += account_data.get("evaluation") or 0.0
            total_principal += account_data.get("principal") or 0.0
            total_profit += account_data.get("profit") or 0.0

    # --- Compute aggregate summary -------------------------------------------
    total_return_rate = (
        round(total_profit / total_principal * 100, 2)
        if total_principal > 0
        else 0.0
    )

    return {
        "report_id": str(uuid.uuid4()),
        "client_name": client_name,
        "generated_at": datetime.utcnow().isoformat(),
        "summary": {
            "total_evaluation": total_evaluation,
            "total_principal": total_principal,
            "total_profit": total_profit,
            "total_return_rate": total_return_rate,
        },
        "accounts": accounts_data,
    }


async def _build_account_report(
    db: AsyncSession,
    account_id: str,
    snapshot_date: date,
    period: str,
) -> Optional[dict]:
    """Build report data for a single account.

    Returns None if the account or its snapshot cannot be found.
    """
    # --- Fetch account metadata ----------------------------------------------
    account_result = await db.execute(
        select(ClientAccount).where(ClientAccount.id == account_id)
    )
    account = account_result.scalar_one_or_none()
    if account is None:
        logger.warning("Account %s not found — skipping.", account_id)
        return None

    # --- Fetch the snapshot closest to snapshot_date -------------------------
    # Try exact date first, then fall back to the most recent before that date.
    snapshot_result = await db.execute(
        select(PortfolioSnapshot)
        .where(
            and_(
                PortfolioSnapshot.client_account_id == account_id,
                PortfolioSnapshot.snapshot_date <= snapshot_date,
            )
        )
        .order_by(PortfolioSnapshot.snapshot_date.desc())
        .limit(1)
    )
    snapshot = snapshot_result.scalar_one_or_none()

    if snapshot is None:
        logger.info(
            "No snapshot found for account %s on or before %s.", account_id, snapshot_date
        )
        # Return a minimal stub so the account is still represented in the report.
        return {
            "account_id": account_id,
            "account_type": account.account_type,
            "account_number": account.account_number,
            "securities_company": account.securities_company,
            "snapshot_date": None,
            "monthly_payment": account.monthly_payment,
            "deposit": None,
            "principal": None,
            "evaluation": None,
            "profit": None,
            "return_rate": None,
            "holdings": [],
            "region_distribution": {},
            "risk_distribution": {},
            "history": [],
            "ai_comment": "",
        }

    # --- Fetch holdings for this snapshot ------------------------------------
    holdings_result = await db.execute(
        select(PortfolioHolding)
        .where(PortfolioHolding.snapshot_id == snapshot.id)
        .order_by(PortfolioHolding.seq)
    )
    holdings = list(holdings_result.scalars().all())

    # --- Compute distributions -----------------------------------------------
    region_dist, risk_dist = _compute_distributions(holdings)

    # --- Compute profit figure -----------------------------------------------
    evaluation = snapshot.total_evaluation or 0.0
    principal = snapshot.total_purchase or 0.0
    profit = snapshot.total_return if snapshot.total_return is not None else (evaluation - principal)

    # --- Build holdings list -------------------------------------------------
    holdings_list = [_holding_to_dict(h) for h in holdings]

    # --- Fetch history with weights ------------------------------------------
    raw_history = await get_history_with_weights(db, account_id, period)
    history = [
        {
            "snapshot_id": item["snapshot_id"],
            "snapshot_date": str(item["snapshot_date"]),
            "total_evaluation": item.get("total_evaluation"),
            "total_return_rate": item.get("total_return_rate"),
            "region_weights": item.get("region_weights", {}),
            "risk_weights": item.get("risk_weights", {}),
        }
        for item in raw_history
    ]

    # --- Assemble pre-AI data dict -------------------------------------------
    account_data = {
        "account_id": account_id,
        "account_type": account.account_type,
        "account_number": account.account_number,
        "securities_company": account.securities_company,
        "snapshot_date": str(snapshot.snapshot_date),
        "monthly_payment": account.monthly_payment,
        "deposit": snapshot.deposit_amount,
        "principal": principal,
        "evaluation": evaluation,
        "profit": profit,
        "return_rate": snapshot.total_return_rate,
        "holdings": holdings_list,
        "region_distribution": region_dist,
        "risk_distribution": risk_dist,
        "history": history,
        "ai_comment": "",  # placeholder
    }

    # --- Generate AI comment (fails gracefully) -------------------------------
    account_data["ai_comment"] = _generate_ai_comment(account_data)

    return account_data
