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
from sqlalchemy import select, and_

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
