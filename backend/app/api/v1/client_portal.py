"""Client portal API — public token-based access for customers."""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Header
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional

from app.db.session import get_db
from app.schemas.client_portal import (
    PortalCheckResponse,
    PortalVerifyRequest,
    PortalTokenResponse,
    SnapshotsListResponse,
    CallReserveRequest,
    CallReserveResponse,
)
from sqlalchemy import select
from app.models.recommended_portfolio import RecommendedPortfolioItem
from app.services import client_portal_service


router = APIRouter(prefix="/client-portal", tags=["client-portal"])


# ---------------------------------------------------------------------------
# Dependency: validate portal JWT from Authorization header
# ---------------------------------------------------------------------------

async def get_portal_client_id(authorization: Optional[str] = Header(None)) -> str:
    """Extract and validate portal JWT, returning client_id."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Portal authentication required",
        )
    token_str = authorization.removeprefix("Bearer ").strip()
    payload = client_portal_service.decode_portal_jwt(token_str)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired portal token",
        )
    return payload["sub"]


# ---------------------------------------------------------------------------
# Public endpoints (no JWT required)
# ---------------------------------------------------------------------------

@router.get("/{token}", response_model=PortalCheckResponse)
async def check_portal_token(
    token: str,
    db: AsyncSession = Depends(get_db),
):
    """Check if portal token exists and return masked client name."""
    result = await client_portal_service.check_portal_token(db, token)
    return PortalCheckResponse(
        exists=result["exists"],
        masked_name=result.get("masked_name"),
    )


@router.post("/{token}/verify", response_model=PortalTokenResponse)
async def verify_client(
    token: str,
    body: PortalVerifyRequest,
    db: AsyncSession = Depends(get_db),
):
    """Verify client identity and issue portal JWT."""
    jwt_token, error = await client_portal_service.verify_client(
        db, token, body.birth_date, body.phone,
        unique_code=getattr(body, 'unique_code', None),
    )

    if error == "locked":
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed attempts. Please try again in 30 minutes.",
        )
    if error == "not_found":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invalid portal link",
        )
    if error == "invalid":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Verification failed. Please check your birth date and phone number.",
        )

    return PortalTokenResponse(access_token=jwt_token)


# ---------------------------------------------------------------------------
# Protected endpoints (portal JWT required)
# ---------------------------------------------------------------------------

@router.get("/{token}/snapshots", response_model=SnapshotsListResponse)
async def get_snapshots(
    token: str,
    client_id: str = Depends(get_portal_client_id),
    db: AsyncSession = Depends(get_db),
):
    """Return snapshot date list grouped by account."""
    accounts = await client_portal_service.get_client_snapshots(db, client_id)
    return SnapshotsListResponse(accounts=accounts)


@router.get("/{token}/report")
async def get_report(
    token: str,
    account_id: str,
    date: str,
    client_id: str = Depends(get_portal_client_id),
    db: AsyncSession = Depends(get_db),
):
    """Return report data for a specific account and date."""
    from datetime import date as date_type
    try:
        parsed_date = date_type.fromisoformat(date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")

    report = await client_portal_service.get_report_for_date(
        db, client_id, account_id, parsed_date
    )
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    return report


@router.get("/{token}/history")
async def get_history(
    token: str,
    account_id: str,
    period: Optional[str] = None,
    client_id: str = Depends(get_portal_client_id),
    db: AsyncSession = Depends(get_db),
):
    """Return snapshot history for charts (portal version)."""
    from app.services import snapshot_service
    # Verify account belongs to client
    from app.models.client import ClientAccount
    from sqlalchemy import select, and_
    result = await db.execute(
        select(ClientAccount).where(
            and_(ClientAccount.id == account_id, ClientAccount.client_id == client_id)
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Account not found")
    raw_items = await snapshot_service.get_history_with_weights(db, account_id, period)
    return {"history": raw_items, "account_id": account_id, "period": period}


@router.get("/{token}/suggestion/{suggest_id}")
async def get_suggestion(
    token: str,
    suggest_id: str,
    client_id: str = Depends(get_portal_client_id),
    db: AsyncSession = Depends(get_db),
):
    """Return suggestion content with holdings detail and expiry status."""
    from app.models.snapshot import PortfolioSnapshot, PortfolioHolding
    from sqlalchemy import select

    suggestion = await client_portal_service.get_suggestion(db, suggest_id)
    if not suggestion:
        raise HTTPException(status_code=404, detail="Suggestion not found")

    expired = datetime.utcnow() > suggestion.expires_at

    # Load holdings from the snapshot to get product names + current weights
    holdings_result = await db.execute(
        select(PortfolioHolding)
        .where(PortfolioHolding.snapshot_id == suggestion.snapshot_id)
        .order_by(PortfolioHolding.seq)
    )
    holdings = holdings_result.scalars().all()

    suggested_weights = suggestion.suggested_weights or {}
    holdings_data = []
    for h in holdings:
        holdings_data.append({
            "holding_id": h.id,
            "product_name": h.product_name,
            "product_code": h.product_code,
            "product_type": h.product_type,
            "risk_level": h.risk_level,
            "region": h.region,
            "current_weight": h.weight or 0,
            "suggested_weight": suggested_weights.get(h.id, h.weight or 0),
            "evaluation_amount": h.evaluation_amount,
            "purchase_amount": h.purchase_amount,
            "return_amount": h.return_amount,
            "return_rate": h.return_rate,
            "current_price": h.current_price,
            "quantity": h.quantity,
        })

    return {
        "id": suggestion.id,
        "account_id": suggestion.account_id,
        "snapshot_id": suggestion.snapshot_id,
        "suggested_weights": suggested_weights,
        "ai_comment": suggestion.ai_comment,
        "expires_at": suggestion.expires_at.isoformat(),
        "created_at": suggestion.created_at.isoformat() if suggestion.created_at else None,
        "is_expired": expired,
        "holdings": holdings_data,
    }


@router.get("/{token}/recommended-portfolio")
async def get_recommended_portfolio_for_portal(
    token: str,
    client_id: str = Depends(get_portal_client_id),
    db: AsyncSession = Depends(get_db),
):
    """Return Dr.GM recommended portfolio items ordered by seq."""
    result = await db.execute(
        select(RecommendedPortfolioItem).order_by(RecommendedPortfolioItem.seq)
    )
    items = result.scalars().all()
    return [
        {
            "id": item.id,
            "product_name": item.product_name,
            "product_code": item.product_code,
            "product_type": item.product_type,
            "region": item.region,
            "current_price": item.current_price,
            "weight_pension": item.weight_pension,
            "weight_irp": item.weight_irp,
            "memo": item.memo,
            "seq": item.seq,
        }
        for item in items
    ]


# ---------------------------------------------------------------------------
# Call reservation (public — authenticated by suggestion context)
# ---------------------------------------------------------------------------

@router.post("/suggestion/{suggest_id}/call-reserve", response_model=CallReserveResponse)
async def create_call_reservation(
    suggest_id: str,
    body: CallReserveRequest,
    db: AsyncSession = Depends(get_db),
):
    """Create a call reservation for a given suggestion."""
    suggestion = await client_portal_service.get_suggestion(db, suggest_id)
    if not suggestion:
        raise HTTPException(status_code=404, detail="Suggestion not found")

    reservation = await client_portal_service.create_call_reservation(
        db,
        suggestion_id=suggest_id,
        preferred_date=body.preferred_date,
        preferred_time=body.preferred_time,
        client_name=body.client_name,
        phone=body.phone,
    )

    # Notify the staff member who created this suggestion via SMS
    try:
        if suggestion.created_by:
            from app.models.user import User
            user_result = await db.execute(
                select(User).where(User.id == suggestion.created_by)
            )
            staff = user_result.scalar_one_or_none()
            if staff and staff.phone:
                from app.services.solapi_service import send_sms
                sms_text = (
                    f"[통화예약 알림]\n"
                    f"고객: {body.client_name or '미입력'}\n"
                    f"희망일시: {reservation.preferred_date} {reservation.preferred_time}\n"
                    f"고객연락처: {body.phone or '없음'}"
                )
                await send_sms(to=staff.phone, text=sms_text)
    except Exception:
        pass  # 알림 실패가 예약 응답을 방해하지 않음

    return CallReserveResponse(
        id=reservation.id,
        suggestion_id=reservation.suggestion_id,
        preferred_date=reservation.preferred_date,
        preferred_time=reservation.preferred_time,
        status=reservation.status or "pending",
    )
