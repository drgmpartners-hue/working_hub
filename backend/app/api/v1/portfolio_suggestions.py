"""Portfolio suggestions API — employee-facing endpoints."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.core.config import settings
from app.core.deps import CurrentUser, get_current_user
from app.schemas.portfolio_suggestion import (
    SuggestionCreate,
    SuggestionCreateResponse,
    SuggestionDetail,
)
from app.services import client_portal_service
from app.services.email_service import send_suggestion_email
from app.models.client import ClientAccount, Client
from app.models.portfolio_suggestion import PortfolioSuggestion
from sqlalchemy import select, and_, func

router = APIRouter(prefix="/portfolios", tags=["portfolio-suggestions"])


@router.post("/suggestions", response_model=SuggestionCreateResponse, status_code=201)
async def create_suggestion(
    body: SuggestionCreate,
    current_user = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a portfolio rebalancing suggestion (expires in 7 days)."""
    # Verify the account belongs to a client of this user
    account_result = await db.execute(
        select(ClientAccount)
        .join(Client, ClientAccount.client_id == Client.id)
        .where(
            and_(
                ClientAccount.id == body.account_id,
                Client.user_id == current_user.id,
            )
        )
    )
    account = account_result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    # Fetch client for portal_token (to build portal link)
    client_result = await db.execute(
        select(Client).where(Client.id == account.client_id)
    )
    client = client_result.scalar_one_or_none()

    suggestion = await client_portal_service.create_suggestion(
        db,
        account_id=body.account_id,
        snapshot_id=body.snapshot_id,
        suggested_weights=body.suggested_weights,
        ai_comment=body.ai_comment,
        manager_note=body.manager_note,
        created_by=current_user.id,
    )

    portal_token = client.portal_token if client else "NO_TOKEN"
    portal_link = f"/client/{portal_token}?suggest={suggestion.id}"

    return SuggestionCreateResponse(
        suggestion_id=suggestion.id,
        portal_link=portal_link,
        expires_at=suggestion.expires_at,
    )


@router.get("/suggestions/{suggestion_id}", response_model=SuggestionDetail)
async def get_suggestion(
    suggestion_id: str,
    current_user = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a suggestion by ID."""
    suggestion = await client_portal_service.get_suggestion(db, suggestion_id)
    if not suggestion:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    return suggestion


@router.put("/suggestions/{suggestion_id}")
async def update_suggestion(
    suggestion_id: str,
    body: SuggestionCreate,
    current_user = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update an existing suggestion (weights, AI comment, manager note)."""
    result = await db.execute(
        select(PortfolioSuggestion).where(PortfolioSuggestion.id == suggestion_id)
    )
    suggestion = result.scalar_one_or_none()
    if not suggestion:
        raise HTTPException(status_code=404, detail="Suggestion not found")

    from datetime import datetime, timedelta
    suggestion.suggested_weights = body.suggested_weights
    if body.ai_comment is not None:
        suggestion.ai_comment = body.ai_comment
    if body.manager_note is not None:
        suggestion.manager_note = body.manager_note
    # 재저장 시 created_at 갱신 (담당자 의견 48시간 기준점)
    suggestion.created_at = datetime.utcnow()
    # 만료일도 갱신 (저장 시점으로부터 7일)
    suggestion.expires_at = datetime.utcnow() + timedelta(days=7)
    await db.commit()
    return {"id": suggestion.id, "updated": True}


@router.get("/suggestions/by-snapshot/{snapshot_id}", response_model=SuggestionDetail)
async def get_suggestion_by_snapshot(
    snapshot_id: str,
    current_user = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get the most recent suggestion for a given snapshot."""
    suggestion = await client_portal_service.get_latest_suggestion_by_snapshot(db, snapshot_id)
    if not suggestion:
        raise HTTPException(status_code=404, detail="No suggestion found for this snapshot")
    return suggestion


@router.post("/suggestions/{suggestion_id}/send")
async def send_suggestion_link(
    suggestion_id: str,
    current_user = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return suggestion link and optionally send it by email.

    Response:
    - suggestion_link: the full URL to the suggestion view
    - email_sent: True if email was actually dispatched
    - expires_at: ISO8601 expiry datetime
    """
    suggestion = await client_portal_service.get_suggestion(db, suggestion_id)
    if not suggestion:
        raise HTTPException(status_code=404, detail="Suggestion not found")

    # Fetch the related account and client
    account_result = await db.execute(
        select(ClientAccount).where(ClientAccount.id == suggestion.account_id)
    )
    account = account_result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="Related account not found")

    client_result = await db.execute(
        select(Client).where(Client.id == account.client_id)
    )
    client = client_result.scalar_one_or_none()
    if not client:
        raise HTTPException(status_code=404, detail="Related client not found")

    portal_token = client.portal_token or "NO_TOKEN"
    suggestion_link = (
        f"{settings.FRONTEND_URL}/client/{portal_token}?suggest={suggestion_id}"
    )

    email_sent = False
    if client.email:
        email_sent = await send_suggestion_email(
            client_email=client.email,
            client_name=client.name,
            suggestion_link=suggestion_link,
            expires_at=suggestion.expires_at,
        )

    return {
        "suggestion_link": suggestion_link,
        "email_sent": email_sent,
        "expires_at": suggestion.expires_at.isoformat() if suggestion.expires_at else None,
    }


@router.get("/suggestions/latest-dates/all")
async def get_suggestion_latest_dates(
    current_user=Depends(get_current_user),
    db: AsyncSession=Depends(get_db),
):
    """Return latest suggestion created_at per client, grouped by client_id."""
    sub = (
        select(
            PortfolioSuggestion.account_id,
            func.max(PortfolioSuggestion.created_at).label("latest_date"),
        )
        .group_by(PortfolioSuggestion.account_id)
        .subquery()
    )
    rows = await db.execute(
        select(
            Client.id.label("client_id"),
            sub.c.latest_date,
        )
        .join(ClientAccount, ClientAccount.client_id == Client.id)
        .join(sub, sub.c.account_id == ClientAccount.id)
        .where(Client.user_id == current_user.id)
    )
    result: dict[str, str] = {}
    for row in rows.all():
        cid = row.client_id
        d = row.latest_date.strftime("%Y-%m-%d") if row.latest_date else ""
        if cid not in result or d > result[cid]:
            result[cid] = d
    return result
