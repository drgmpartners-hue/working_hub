"""Client portal business logic.

Handles:
- Token lookup / name masking
- Verification with brute-force lockout (in-memory, no Redis required)
- Portal-specific JWT generation
- Snapshot listing per client
- Report data retrieval
- Suggestion lookup
- Call reservation creation
"""
import uuid
from datetime import datetime, timedelta, date
from typing import Optional
from collections import defaultdict

from jose import jwt
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_

from app.core.config import settings
from app.core.security import ALGORITHM
from app.models.client import Client, ClientAccount
from app.models.snapshot import PortfolioSnapshot, PortfolioHolding
from app.models.portfolio_suggestion import PortfolioSuggestion
from app.models.call_reservation import CallReservation

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

PORTAL_TOKEN_EXPIRE_HOURS = 24
MAX_FAILURES = 3
LOCKOUT_MINUTES = 30
PORTAL_SCOPE = "client_portal"

# ---------------------------------------------------------------------------
# In-memory brute-force tracker
# {token: {"failures": int, "locked_until": datetime | None}}
# ---------------------------------------------------------------------------

_lockout_store: dict[str, dict] = defaultdict(lambda: {"failures": 0, "locked_until": None})


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def mask_name(name: str) -> str:
    """Mask middle characters of a name.

    Examples:
        "홍길동" -> "홍*동"
        "홍길" -> "홍*"
        "홍" -> "*"
    """
    if len(name) <= 1:
        return "*"
    if len(name) == 2:
        return name[0] + "*"
    return name[0] + "*" * (len(name) - 2) + name[-1]


def _is_locked(token: str) -> bool:
    state = _lockout_store[token]
    if state["locked_until"] and datetime.utcnow() < state["locked_until"]:
        return True
    # Auto-clear if lock expired
    if state["locked_until"] and datetime.utcnow() >= state["locked_until"]:
        state["failures"] = 0
        state["locked_until"] = None
    return False


def _record_failure(token: str) -> int:
    """Increment failure counter. Returns remaining attempts before lock."""
    state = _lockout_store[token]
    state["failures"] += 1
    if state["failures"] >= MAX_FAILURES:
        state["locked_until"] = datetime.utcnow() + timedelta(minutes=LOCKOUT_MINUTES)
    return MAX_FAILURES - state["failures"]


def _reset_failures(token: str) -> None:
    _lockout_store[token] = {"failures": 0, "locked_until": None}


def create_portal_jwt(client_id: str, token: str) -> str:
    """Create a portal-scoped JWT valid for 24 hours."""
    expire = datetime.utcnow() + timedelta(hours=PORTAL_TOKEN_EXPIRE_HOURS)
    payload = {
        "sub": client_id,
        "portal_token": token,
        "scope": PORTAL_SCOPE,
        "exp": expire,
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=ALGORITHM)


def decode_portal_jwt(token_str: str) -> Optional[dict]:
    """Decode and validate a portal JWT. Returns payload dict or None."""
    try:
        payload = jwt.decode(token_str, settings.SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("scope") != PORTAL_SCOPE:
            return None
        return payload
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Service functions
# ---------------------------------------------------------------------------

async def get_client_by_portal_token(
    db: AsyncSession, portal_token: str
) -> Optional[Client]:
    """Fetch a client by their portal_token."""
    result = await db.execute(
        select(Client).where(Client.portal_token == portal_token)
    )
    return result.scalar_one_or_none()


async def check_portal_token(
    db: AsyncSession, portal_token: str
) -> dict:
    """Return {exists, masked_name} for a given portal token."""
    client = await get_client_by_portal_token(db, portal_token)
    if not client:
        return {"exists": False, "masked_name": None}
    return {"exists": True, "masked_name": mask_name(client.name)}


async def verify_client(
    db: AsyncSession,
    portal_token: str,
    birth_date: date,
    phone: str,
) -> tuple[Optional[str], str]:
    """Verify client identity. Returns (jwt_token, error_message).

    Error messages:
    - "locked": account temporarily locked
    - "not_found": no client with that token
    - "invalid": birth_date or phone mismatch
    - "": success (jwt_token is set)
    """
    if _is_locked(portal_token):
        return None, "locked"

    client = await get_client_by_portal_token(db, portal_token)
    if not client:
        return None, "not_found"

    # Verify birth_date and phone
    birth_match = client.birth_date == birth_date
    # Normalize phone for comparison
    phone_norm = phone.replace("-", "").replace(" ", "")
    stored_phone = (client.phone or "").replace("-", "").replace(" ", "")
    phone_match = stored_phone == phone_norm

    if not (birth_match and phone_match):
        _record_failure(portal_token)
        return None, "invalid"

    _reset_failures(portal_token)
    token = create_portal_jwt(client.id, portal_token)
    return token, ""


async def get_client_snapshots(
    db: AsyncSession, client_id: str
) -> list[dict]:
    """Return per-account snapshot date lists for a client."""
    # Get all accounts for the client
    accounts_result = await db.execute(
        select(ClientAccount).where(ClientAccount.client_id == client_id)
    )
    accounts = accounts_result.scalars().all()

    result = []
    for account in accounts:
        snapshots_result = await db.execute(
            select(PortfolioSnapshot.snapshot_date)
            .where(PortfolioSnapshot.client_account_id == account.id)
            .order_by(PortfolioSnapshot.snapshot_date.desc())
        )
        dates = [str(row[0]) for row in snapshots_result.all()]
        result.append(
            {
                "account_id": account.id,
                "account_type": account.account_type,
                "dates": dates,
            }
        )
    return result


async def get_report_for_date(
    db: AsyncSession,
    client_id: str,
    account_id: str,
    snapshot_date: date,
) -> Optional[dict]:
    """Return report data for a specific account + date.

    Only includes AI comment if this is the most recent snapshot for the account.
    """
    # Verify account belongs to client
    account_result = await db.execute(
        select(ClientAccount).where(
            and_(ClientAccount.id == account_id, ClientAccount.client_id == client_id)
        )
    )
    account = account_result.scalar_one_or_none()
    if not account:
        return None

    # Find requested snapshot
    snap_result = await db.execute(
        select(PortfolioSnapshot).where(
            and_(
                PortfolioSnapshot.client_account_id == account_id,
                PortfolioSnapshot.snapshot_date == snapshot_date,
            )
        )
    )
    snapshot = snap_result.scalar_one_or_none()
    if not snapshot:
        return None

    # Find most recent snapshot date for this account
    latest_result = await db.execute(
        select(PortfolioSnapshot.snapshot_date)
        .where(PortfolioSnapshot.client_account_id == account_id)
        .order_by(PortfolioSnapshot.snapshot_date.desc())
        .limit(1)
    )
    latest_date_row = latest_result.first()
    is_latest = latest_date_row and latest_date_row[0] == snapshot_date

    # Get holdings
    holdings_result = await db.execute(
        select(PortfolioHolding).where(PortfolioHolding.snapshot_id == snapshot.id)
    )
    holdings = holdings_result.scalars().all()

    holdings_data = [
        {
            "id": h.id,
            "product_name": h.product_name,
            "product_code": h.product_code,
            "product_type": h.product_type,
            "risk_level": h.risk_level,
            "region": h.region,
            "purchase_amount": h.purchase_amount,
            "evaluation_amount": h.evaluation_amount,
            "return_amount": h.return_amount,
            "return_rate": h.return_rate,
            "weight": h.weight,
            "reference_price": h.reference_price,
            "seq": h.seq,
        }
        for h in holdings
    ]

    # AI comment only for latest snapshot
    ai_comment = snapshot.parsed_data.get("ai_comment") if (is_latest and snapshot.parsed_data) else None

    return {
        "snapshot_id": snapshot.id,
        "account_id": account_id,
        "account_type": account.account_type,
        "snapshot_date": str(snapshot.snapshot_date),
        "deposit_amount": snapshot.deposit_amount,
        "total_purchase": snapshot.total_purchase,
        "total_evaluation": snapshot.total_evaluation,
        "total_return": snapshot.total_return,
        "total_return_rate": snapshot.total_return_rate,
        "holdings": holdings_data,
        "ai_comment": ai_comment,
        "is_latest": is_latest,
    }


async def get_suggestion(
    db: AsyncSession, suggestion_id: str
) -> Optional[PortfolioSuggestion]:
    """Fetch a suggestion by ID."""
    result = await db.execute(
        select(PortfolioSuggestion).where(PortfolioSuggestion.id == suggestion_id)
    )
    return result.scalar_one_or_none()


async def create_call_reservation(
    db: AsyncSession,
    suggestion_id: str,
    preferred_date: date,
    preferred_time: str,
    client_name: Optional[str] = None,
    phone: Optional[str] = None,
) -> CallReservation:
    """Create a call reservation linked to a suggestion."""
    reservation = CallReservation(
        id=str(uuid.uuid4()),
        suggestion_id=suggestion_id,
        client_name=client_name,
        phone=phone,
        preferred_date=preferred_date,
        preferred_time=preferred_time,
        status="pending",
    )
    db.add(reservation)
    await db.commit()
    await db.refresh(reservation)
    return reservation


async def create_suggestion(
    db: AsyncSession,
    account_id: str,
    snapshot_id: str,
    suggested_weights: dict,
    ai_comment: Optional[str] = None,
) -> PortfolioSuggestion:
    """Create a new portfolio suggestion (expires in 7 days)."""
    suggestion = PortfolioSuggestion(
        id=str(uuid.uuid4()),
        account_id=account_id,
        snapshot_id=snapshot_id,
        suggested_weights=suggested_weights,
        ai_comment=ai_comment,
        expires_at=datetime.utcnow() + timedelta(days=7),
    )
    db.add(suggestion)
    await db.commit()
    await db.refresh(suggestion)
    return suggestion


async def update_client_portal_info(
    db: AsyncSession,
    client_id: str,
    user_id: str,
    birth_date: Optional[date] = None,
    phone: Optional[str] = None,
    email: Optional[str] = None,
) -> Optional[Client]:
    """Update portal-related fields on a client (employee action)."""
    result = await db.execute(
        select(Client).where(and_(Client.id == client_id, Client.user_id == user_id))
    )
    client = result.scalar_one_or_none()
    if not client:
        return None

    if birth_date is not None:
        client.birth_date = birth_date
    if phone is not None:
        client.phone = phone
    if email is not None:
        client.email = email

    # Ensure portal_token is generated if missing
    if not client.portal_token:
        client.portal_token = str(uuid.uuid4())

    await db.commit()
    await db.refresh(client)
    return client
