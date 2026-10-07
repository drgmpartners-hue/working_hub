"""Client portal business logic.

Handles:
- Token lookup / name masking
- Verification with brute-force lockout (DB 기록, 서버 여러 대여도 공유)
- Portal-specific JWT generation
- Snapshot listing per client
- Report data retrieval
- Suggestion lookup
- Call reservation creation
"""
import hmac
import uuid
from datetime import datetime, timedelta, date
from typing import Optional
from app.core.encryption import encrypt_ssn

from jose import jwt
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import and_, select, update

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
# Brute-force lockout — DB 기록(clients.portal_failures·portal_locked_until), 수정_tasks P1-20
# 있는 고객만 기록하므로 없는 링크로 아무리 요청해도 쌓이지 않고, 서버가 여러 대여도 같은 값을 본다.
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


def _now() -> datetime:
    return datetime.utcnow()


def is_locked(client: Client) -> bool:
    return bool(client.portal_locked_until and _now() < client.portal_locked_until)


async def record_failure(db: AsyncSession, client_id: str) -> int:
    """실패 1회 기록(원자적 +1). 3회가 되면 30분 잠그고 횟수는 0으로. 남은 시도 횟수를 돌려준다(잠기면 0)."""
    n = (await db.execute(
        update(Client).where(Client.id == client_id)
        .values(portal_failures=Client.portal_failures + 1)
        .returning(Client.portal_failures)
    )).scalar_one()
    if n >= MAX_FAILURES:
        await db.execute(update(Client).where(Client.id == client_id).values(
            portal_failures=0, portal_locked_until=_now() + timedelta(minutes=LOCKOUT_MINUTES)))
        await db.commit()
        return 0
    await db.commit()
    return MAX_FAILURES - n


async def reset_failures(db: AsyncSession, client: Client) -> None:
    if client.portal_failures or client.portal_locked_until:
        await db.execute(update(Client).where(Client.id == client.id).values(portal_failures=0, portal_locked_until=None))
        await db.commit()


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
    """링크 열쇠로 고객 찾기. 중복 고객을 합친 경우 지운 쪽 링크(portal_token_alt)로도 찾는다."""
    from sqlalchemy import or_

    result = await db.execute(
        select(Client).where(or_(Client.portal_token == portal_token, Client.portal_token_alt == portal_token))
    )
    return result.scalars().first()


async def current_portal_token(db: AsyncSession, client_id: str) -> Optional[str]:
    """고객의 지금 포털 링크 열쇠(링크를 새로 만들면 예전 JWT 는 무효가 된다)."""
    return (await db.execute(select(Client.portal_token).where(Client.id == client_id))).scalar_one_or_none()


async def current_portal_tokens(db: AsyncSession, client_id: str) -> set[str]:
    """지금 유효한 링크 열쇠들(본 링크 + 중복 합치기로 남긴 예전 링크)."""
    row = (await db.execute(select(Client.portal_token, Client.portal_token_alt).where(Client.id == client_id))).first()
    return {t for t in (row or ()) if t}


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
    unique_code: Optional[str] = None,
) -> tuple[Optional[str], str]:
    """Verify client identity. Returns (jwt_token, error_message).

    Error messages:
    - "locked": account temporarily locked (3회 실패 → 30분)
    - "no_code": 고객에게 고유번호가 없음(담당자 문의)
    - "not_found": no client with that token
    - "invalid": birth_date or phone or unique_code mismatch
    - "": success (jwt_token is set)
    """
    client = await get_client_by_portal_token(db, portal_token)
    if not client:
        return None, "not_found"
    if is_locked(client):
        return None, "locked"
    # 고유번호가 없는 고객은 빈 값끼리 일치해 버리므로 들어올 수 없게 한다(수정_tasks P2-9) — 담당자가 번호를 만들어야 함
    if not (client.unique_code or "").strip():
        return None, "no_code"

    code_match = hmac.compare_digest((client.unique_code or "").strip(), (unique_code or "").strip())
    birth_match = client.birth_date is not None and client.birth_date == birth_date
    phone_norm = "".join(ch for ch in (phone or "") if ch.isdigit())
    stored_phone = "".join(ch for ch in (client.phone or "") if ch.isdigit())
    phone_match = bool(stored_phone) and hmac.compare_digest(stored_phone, phone_norm)

    if not (birth_match and phone_match and code_match):
        left = await record_failure(db, client.id)
        return None, ("locked" if left == 0 else "invalid")

    await reset_failures(db, client)
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
                "account_number": account.account_number or "",
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

    holdings_data = []
    for h in holdings:
        # Calculate return_rate if not stored
        rr = h.return_rate
        if rr is None and h.purchase_amount and h.purchase_amount > 0 and h.evaluation_amount is not None:
            rr = round((h.evaluation_amount - h.purchase_amount) / h.purchase_amount * 100, 2)
        holdings_data.append({
            "id": h.id,
            "product_name": h.product_name,
            "product_code": h.product_code,
            "product_type": h.product_type,
            "risk_level": h.risk_level,
            "region": h.region,
            "purchase_amount": h.purchase_amount,
            "evaluation_amount": h.evaluation_amount,
            "return_amount": h.return_amount,
            "return_rate": rr,
            "weight": h.weight,
            "reference_price": h.reference_price,
            "current_price": h.current_price,
            "seq": h.seq,
        })

    # AI comment - show for all snapshots if available
    ai_comment = snapshot.parsed_data.get("ai_comment") if snapshot.parsed_data else None

    # Compute region/risk distribution from holdings
    total_eval = sum(h.evaluation_amount or 0 for h in holdings)
    region_map: dict[str, float] = {}
    risk_map: dict[str, float] = {}
    for h in holdings:
        amt = h.evaluation_amount or 0
        r = h.region or "미분류"
        region_map[r] = region_map.get(r, 0) + amt
        rl = h.risk_level or "미분류"
        risk_map[rl] = risk_map.get(rl, 0) + amt

    region_dist = [
        {"name": k, "value": round(v / total_eval * 100, 2) if total_eval else 0}
        for k, v in region_map.items()
    ]
    risk_dist = [
        {"name": k, "value": round(v / total_eval * 100, 2) if total_eval else 0}
        for k, v in risk_map.items()
    ]

    return {
        "snapshot_id": snapshot.id,
        "account_id": account_id,
        "account_type": account.account_type,
        "account_number": account.account_number or "",
        "snapshot_date": str(snapshot.snapshot_date),
        "deposit_amount": snapshot.deposit_amount,
        "total_purchase": snapshot.total_purchase,
        "total_evaluation": snapshot.total_evaluation,
        "total_return": snapshot.total_return,
        "total_return_rate": snapshot.total_return_rate,
        "holdings": holdings_data,
        "region_distribution": region_dist,
        "risk_distribution": risk_dist,
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


async def get_latest_suggestion_by_snapshot(
    db: AsyncSession, snapshot_id: str
) -> Optional[PortfolioSuggestion]:
    """Fetch the most recent suggestion for a given snapshot."""
    result = await db.execute(
        select(PortfolioSuggestion)
        .where(PortfolioSuggestion.snapshot_id == snapshot_id)
        .order_by(PortfolioSuggestion.created_at.desc())
        .limit(1)
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
    manager_note: Optional[str] = None,
    created_by: Optional[str] = None,
) -> PortfolioSuggestion:
    """Create a new portfolio suggestion (expires in 7 days)."""
    suggestion = PortfolioSuggestion(
        id=str(uuid.uuid4()),
        account_id=account_id,
        snapshot_id=snapshot_id,
        suggested_weights=suggested_weights,
        ai_comment=ai_comment,
        manager_note=manager_note,
        created_by=created_by,
        expires_at=datetime.utcnow() + timedelta(days=30),
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
    ssn: Optional[str] = None,
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
    if ssn is not None:
        client.ssn_encrypted = encrypt_ssn(ssn) if ssn else None

    # Ensure portal_token is generated if missing
    if not client.portal_token:
        client.portal_token = str(uuid.uuid4())

    await db.commit()
    await db.refresh(client)
    return client
