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

@router.get("/{token}/snapshots")
async def get_snapshots(
    token: str,
    client_id: str = Depends(get_portal_client_id),
    db: AsyncSession = Depends(get_db),
):
    """Return snapshot date list grouped by account + client info."""
    from app.models.client import Client
    client_result = await db.execute(select(Client).where(Client.id == client_id))
    client = client_result.scalar_one_or_none()
    accounts = await client_portal_service.get_client_snapshots(db, client_id)
    return {
        "accounts": accounts,
        "client_name": client.name if client else "",
        "unique_code": client.unique_code if client else "",
    }


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

    raw_weights = suggestion.suggested_weights or {}
    # Normalize: if any weight > 1, treat as percentage and convert to 0-1
    numeric_vals = [v for v in raw_weights.values() if isinstance(v, (int, float))]
    max_w = max(numeric_vals) if numeric_vals else 0
    suggested_weights = {
        k: (v / 100 if max_w > 1 else v) if isinstance(v, (int, float)) else v
        for k, v in raw_weights.items()
    } if raw_weights else {}

    # Extract saved prices for new products
    raw_prices = raw_weights.get('_prices')
    print(f"[PORTAL DEBUG] _prices type={type(raw_prices)}, value={raw_prices}", flush=True)
    if isinstance(raw_prices, dict):
        saved_prices = raw_prices
    elif isinstance(raw_prices, str):
        import json as _json
        try:
            saved_prices = _json.loads(raw_prices)
        except Exception:
            saved_prices = {}
    else:
        saved_prices = {}
    print(f"[PORTAL DEBUG] saved_prices={saved_prices}", flush=True)

    # Calculate total evaluation for weight computation
    total_eval = sum(h.evaluation_amount or 0 for h in holdings)

    holdings_data = []
    matched_ids = set()
    for h in holdings:
        # Calculate current weight if not stored
        cur_weight = h.weight
        if (cur_weight is None or cur_weight == 0) and total_eval > 0 and h.evaluation_amount:
            cur_weight = h.evaluation_amount / total_eval
        # Calculate return_rate if not stored
        rr = h.return_rate
        if rr is None and h.purchase_amount and h.purchase_amount > 0 and h.evaluation_amount is not None:
            rr = round((h.evaluation_amount - h.purchase_amount) / h.purchase_amount * 100, 2)
        holdings_data.append({
            "holding_id": h.id,
            "product_name": h.product_name,
            "product_code": h.product_code,
            "product_type": h.product_type,
            "risk_level": h.risk_level,
            "region": h.region,
            "current_weight": cur_weight or 0,
            "suggested_weight": suggested_weights.get(h.id, cur_weight or 0),
            "evaluation_amount": h.evaluation_amount,
            "purchase_amount": h.purchase_amount,
            "return_amount": h.return_amount,
            "return_rate": rr,
            "current_price": h.reference_price or h.current_price or saved_prices.get(h.id),
            "reference_price": h.reference_price or h.current_price or saved_prices.get(h.id),
            "quantity": h.quantity,
        })
        matched_ids.add(h.id)

    # Add virtual/new items from suggested_weights that aren't in snapshot holdings
    from app.models.product_master import ProductMaster
    for key, sw in suggested_weights.items():
        if key in matched_ids or key == '_prices' or not isinstance(sw, (int, float)):
            continue
        # This is a new product (virtual_ or __new__ or new:)
        product_name = key
        if key.startswith('virtual_'):
            product_name = key[8:]
        elif key.startswith('__new__'):
            product_name = key[7:]  # might be timestamp, need lookup
        elif key.startswith('new:'):
            product_name = key[4:]

        # Try to find product info from master
        pm_result = await db.execute(
            select(ProductMaster).where(ProductMaster.product_name == product_name).limit(1)
        )
        pm = pm_result.scalar_one_or_none()

        holdings_data.append({
            "holding_id": key,
            "product_name": pm.product_name if pm else product_name,
            "product_code": pm.product_code if pm else None,
            "product_type": pm.product_type if pm else None,
            "risk_level": pm.risk_level if pm else None,
            "region": pm.region if pm else None,
            "current_weight": 0,
            "suggested_weight": sw,
            "evaluation_amount": 0,
            "purchase_amount": 0,
            "return_amount": 0,
            "return_rate": 0,
            "current_price": (
                saved_prices.get(key)
                or saved_prices.get(f"new:{product_name}")
                or saved_prices.get(f"virtual_{product_name}")
                or saved_prices.get(product_name)
                or (pm.current_price if pm and hasattr(pm, 'current_price') else None)
            ),
            "reference_price": (
                saved_prices.get(key)
                or saved_prices.get(f"new:{product_name}")
                or saved_prices.get(f"virtual_{product_name}")
                or saved_prices.get(product_name)
                or (pm.current_price if pm and hasattr(pm, 'current_price') else None)
            ),
            "quantity": 0,
            "is_new": True,
        })

    # ai_comment fallback: suggestion에 없으면 snapshot의 parsed_data에서 가져오기
    ai_comment = suggestion.ai_comment
    if not ai_comment:
        snapshot_result = await db.execute(
            select(PortfolioSnapshot).where(PortfolioSnapshot.id == suggestion.snapshot_id)
        )
        snapshot = snapshot_result.scalar_one_or_none()
        if snapshot and snapshot.parsed_data:
            parsed = snapshot.parsed_data if isinstance(snapshot.parsed_data, dict) else {}
            ai_analysis = parsed.get("ai_comment", "")
            ai_change = parsed.get("ai_change_comment", "")
            if ai_analysis or ai_change:
                ai_comment = f"[포트폴리오 분석]\n{ai_analysis}\n\n[변경 분석]\n{ai_change}"

    return {
        "id": suggestion.id,
        "account_id": suggestion.account_id,
        "snapshot_id": suggestion.snapshot_id,
        "suggested_weights": suggested_weights,
        "ai_comment": ai_comment,
        "expires_at": suggestion.expires_at.isoformat(),
        "created_at": suggestion.created_at.isoformat() if suggestion.created_at else None,
        "is_expired": expired,
        "holdings": holdings_data,
    }


@router.get("/{token}/suggestions")
async def list_suggestions_for_portal(
    token: str,
    client_id: str = Depends(get_portal_client_id),
    db: AsyncSession = Depends(get_db),
):
    """Return all valid (non-expired) suggestions grouped by account for this client."""
    from app.models.portfolio_suggestion import PortfolioSuggestion
    from app.models.client import ClientAccount, Client
    from sqlalchemy import and_, desc

    # Get all accounts for this client
    accounts_result = await db.execute(
        select(ClientAccount).where(ClientAccount.client_id == client_id)
    )
    accounts = accounts_result.scalars().all()

    result = []
    now = datetime.utcnow()
    for acct in accounts:
        # Get all non-expired suggestions for this account, latest first
        sug_result = await db.execute(
            select(PortfolioSuggestion)
            .where(
                and_(
                    PortfolioSuggestion.account_id == acct.id,
                    PortfolioSuggestion.expires_at > now,
                )
            )
            .order_by(desc(PortfolioSuggestion.created_at))
        )
        suggestions = sug_result.scalars().all()

        if suggestions:
            # Return dates with suggestion IDs
            dates = []
            seen_snapshots = set()
            for s in suggestions:
                if s.snapshot_id not in seen_snapshots:
                    seen_snapshots.add(s.snapshot_id)
                    dates.append({
                        "suggestion_id": s.id,
                        "snapshot_id": s.snapshot_id,
                        "created_at": s.created_at.isoformat() if s.created_at else None,
                        "has_ai_comment": bool(s.ai_comment),
                    })

            result.append({
                "account_id": acct.id,
                "account_type": acct.account_type,
                "account_number": acct.account_number,
                "securities_company": acct.securities_company,
                "dates": dates,
            })

    return result


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
