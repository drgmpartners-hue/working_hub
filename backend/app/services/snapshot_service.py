"""Snapshot service - create/retrieve portfolio snapshots."""
import uuid
import os
from datetime import date, datetime, timedelta
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from sqlalchemy.orm import selectinload
from app.models.snapshot import PortfolioSnapshot, PortfolioHolding
from app.models.client import ClientAccount
from app.services.vision_service import extract_portfolio_from_image
from app.schemas.snapshot import HoldingUpdateRequest

UPLOAD_DIR = "uploads/snapshots"


async def create_snapshot(
    db: AsyncSession,
    client_account_id: str,
    image_bytes: bytes,
    mime_type: str,
    snapshot_date: date,
) -> PortfolioSnapshot:
    """Process image with Gemini Vision, save snapshot + holdings to DB."""
    os.makedirs(UPLOAD_DIR, exist_ok=True)

    # Save image file
    ext = "png" if "png" in mime_type else "jpg"
    image_filename = f"{uuid.uuid4().hex}.{ext}"
    image_path = os.path.join(UPLOAD_DIR, image_filename)
    with open(image_path, "wb") as f:
        f.write(image_bytes)

    # Extract data via Gemini Vision
    extracted = await extract_portfolio_from_image(image_bytes, mime_type)

    # Create snapshot record
    snapshot = PortfolioSnapshot(
        id=str(uuid.uuid4()),
        client_account_id=client_account_id,
        snapshot_date=snapshot_date,
        image_path=image_path,
        parsed_data=extracted,
        deposit_amount=extracted.get("deposit_amount"),
        foreign_deposit_amount=extracted.get("foreign_deposit_amount"),
        total_assets=extracted.get("total_assets"),
        total_purchase=extracted.get("total_purchase"),
        total_evaluation=extracted.get("total_evaluation"),
        total_return=extracted.get("total_return"),
        total_return_rate=extracted.get("total_return_rate"),
    )
    db.add(snapshot)
    await db.flush()  # get snapshot.id

    # Create holding records
    for item in extracted.get("holdings", []):
        holding = PortfolioHolding(
            id=str(uuid.uuid4()),
            snapshot_id=snapshot.id,
            product_name=item.get("product_name", ""),
            product_code=item.get("product_code"),
            product_type=item.get("product_type"),
            risk_level=item.get("risk_level"),
            region=item.get("region"),
            quantity=item.get("quantity"),
            purchase_price=item.get("purchase_price"),
            current_price=item.get("current_price"),
            purchase_amount=item.get("purchase_amount"),
            evaluation_amount=item.get("evaluation_amount"),
            return_amount=item.get("return_amount"),
            return_rate=item.get("return_rate"),
            weight=item.get("weight"),
            reference_price=item.get("reference_price"),
            seq=item.get("seq"),
        )
        db.add(holding)

    await db.commit()

    # 자동으로 상품 마스터 적용 (종목코드, 위험도, 지역)
    try:
        await apply_master_to_snapshot(db, snapshot.id)
    except (ImportError, Exception):
        pass  # 마스터 테이블 없어도 무시

    await db.refresh(snapshot)
    return snapshot


async def list_snapshots(
    db: AsyncSession,
    client_account_id: str,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
) -> list[PortfolioSnapshot]:
    filters = [PortfolioSnapshot.client_account_id == client_account_id]
    if date_from:
        filters.append(PortfolioSnapshot.snapshot_date >= date_from)
    if date_to:
        filters.append(PortfolioSnapshot.snapshot_date <= date_to)
    result = await db.execute(
        select(PortfolioSnapshot)
        .where(and_(*filters))
        .order_by(PortfolioSnapshot.snapshot_date.desc())
    )
    return result.scalars().all()


async def get_snapshot_with_holdings(
    db: AsyncSession, snapshot_id: str
) -> Optional[PortfolioSnapshot]:
    result = await db.execute(
        select(PortfolioSnapshot)
        .where(PortfolioSnapshot.id == snapshot_id)
        .options(selectinload(PortfolioSnapshot.holdings))
    )
    return result.scalar_one_or_none()


async def get_report_data(
    db: AsyncSession,
    client_account_id: str,
    target_date: Optional[date] = None,
) -> Optional[dict]:
    """Get full report data: latest snapshot + historical return rates."""
    # Get latest (or specific date) snapshot
    filters = [PortfolioSnapshot.client_account_id == client_account_id]
    if target_date:
        filters.append(PortfolioSnapshot.snapshot_date == target_date)

    result = await db.execute(
        select(PortfolioSnapshot)
        .where(and_(*filters))
        .order_by(PortfolioSnapshot.snapshot_date.desc())
        .limit(1)
    )
    snapshot = result.scalar_one_or_none()
    if not snapshot:
        return None

    # Get holdings for this snapshot
    holdings_result = await db.execute(
        select(PortfolioHolding)
        .where(PortfolioHolding.snapshot_id == snapshot.id)
        .order_by(PortfolioHolding.seq)
    )
    holdings = holdings_result.scalars().all()

    # Get all historical snapshots for return rate chart (최대 12개월)
    history_result = await db.execute(
        select(PortfolioSnapshot.snapshot_date, PortfolioSnapshot.total_return_rate)
        .where(PortfolioSnapshot.client_account_id == client_account_id)
        .order_by(PortfolioSnapshot.snapshot_date)
    )
    history = [
        {"date": str(row.snapshot_date), "return_rate": row.total_return_rate}
        for row in history_result.all()
    ]

    # Get account info
    account_result = await db.execute(
        select(ClientAccount).where(ClientAccount.id == client_account_id)
    )
    account = account_result.scalar_one_or_none()

    return {
        "snapshot": {
            "id": snapshot.id,
            "snapshot_date": str(snapshot.snapshot_date),
            "deposit_amount": snapshot.deposit_amount,
            "total_purchase": snapshot.total_purchase,
            "total_evaluation": snapshot.total_evaluation,
            "total_return": snapshot.total_return,
            "total_return_rate": snapshot.total_return_rate,
        },
        "account": {
            "id": account.id if account else client_account_id,
            "account_type": account.account_type if account else "unknown",
            "account_number": account.account_number if account else None,
            "securities_company": account.securities_company if account else None,
            "monthly_payment": account.monthly_payment if account else None,
        },
        "holdings": [
            {
                "id": h.id,
                "seq": h.seq,
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
            }
            for h in holdings
        ],
        "history": history,
    }


async def update_holding(
    db: AsyncSession,
    snapshot_id: str,
    holding_id: str,
    data: HoldingUpdateRequest,
) -> Optional[PortfolioHolding]:
    """Manually update mutable fields on a single PortfolioHolding.

    Returns the updated holding, or None if the holding is not found
    or does not belong to the given snapshot.
    """
    result = await db.execute(
        select(PortfolioHolding).where(
            and_(
                PortfolioHolding.id == holding_id,
                PortfolioHolding.snapshot_id == snapshot_id,
            )
        )
    )
    holding = result.scalar_one_or_none()
    if not holding:
        return None

    update_fields = data.model_dump(exclude_unset=True)
    for field, value in update_fields.items():
        setattr(holding, field, value)

    await db.commit()
    await db.refresh(holding)
    return holding


_PERIOD_DAYS: dict[str, int] = {
    "3m": 90,
    "6m": 180,
    "1y": 365,
}


async def get_history_with_weights(
    db: AsyncSession,
    client_account_id: str,
    period: Optional[str] = None,
) -> list[dict]:
    """Return snapshot history with per-snapshot region/risk weight breakdown.

    Parameters
    ----------
    db:
        Async SQLAlchemy session.
    client_account_id:
        The account whose snapshots to fetch.
    period:
        One of "3m", "6m", "1y".  None means all history.

    Returns
    -------
    A list of dicts matching the SnapshotHistoryItem schema, ordered by
    snapshot_date ascending so the caller can feed them directly into a chart.
    """
    filters = [PortfolioSnapshot.client_account_id == client_account_id]

    if period is not None:
        days = _PERIOD_DAYS.get(period)
        if days is None:
            raise ValueError(f"Invalid period '{period}'. Use 3m, 6m or 1y.")
        cutoff = datetime.utcnow().date() - timedelta(days=days)
        filters.append(PortfolioSnapshot.snapshot_date >= cutoff)

    snapshots_result = await db.execute(
        select(PortfolioSnapshot)
        .where(and_(*filters))
        .order_by(PortfolioSnapshot.snapshot_date.asc())
    )
    snapshots: list[PortfolioSnapshot] = list(snapshots_result.scalars().all())

    if not snapshots:
        return []

    snapshot_ids = [s.id for s in snapshots]

    holdings_result = await db.execute(
        select(PortfolioHolding).where(
            PortfolioHolding.snapshot_id.in_(snapshot_ids)
        )
    )
    all_holdings: list[PortfolioHolding] = list(holdings_result.scalars().all())

    # Group holdings by snapshot_id
    holdings_by_snapshot: dict[str, list[PortfolioHolding]] = {}
    for h in all_holdings:
        holdings_by_snapshot.setdefault(h.snapshot_id, []).append(h)

    items: list[dict] = []
    for snap in snapshots:
        holdings = holdings_by_snapshot.get(snap.id, [])

        # Sum evaluation_amount by region and risk_level
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

        # Convert totals to weights (0.0–1.0, rounded to 4 decimal places)
        if grand_total > 0:
            region_weights = {
                k: round(v / grand_total, 4) for k, v in region_totals.items()
            }
            risk_weights = {
                k: round(v / grand_total, 4) for k, v in risk_totals.items()
            }
        else:
            region_weights = {}
            risk_weights = {}

        items.append(
            {
                "snapshot_id": snap.id,
                "snapshot_date": snap.snapshot_date,
                "total_evaluation": snap.total_evaluation,
                "total_return_rate": snap.total_return_rate,
                "region_weights": region_weights,
                "risk_weights": risk_weights,
            }
        )

    return items


async def apply_master_to_snapshot(
    db: AsyncSession,
    snapshot_id: str,
) -> dict:
    """Look up risk_level and region from product_master for every holding in
    the given snapshot and apply them in bulk.

    Returns {"updated": N, "not_found": ["상품명1", ...]}

    If the product_master table / model is not available (e.g. the migration
    has not been run yet), the function raises an ImportError which the caller
    should convert to an appropriate HTTP error.
    """
    # Late import so that the rest of snapshot_service works even before
    # PF-R1-T1 is merged.
    try:
        from app.models.product_master import ProductMaster  # noqa: PLC0415
    except ImportError as exc:
        raise ImportError(
            "product_master model is not yet available. "
            "Run PF-R1-T1 first."
        ) from exc

    # Load all holdings for this snapshot
    holdings_result = await db.execute(
        select(PortfolioHolding).where(PortfolioHolding.snapshot_id == snapshot_id)
    )
    holdings: list[PortfolioHolding] = list(holdings_result.scalars().all())

    if not holdings:
        return {"updated": 0, "not_found": []}

    # Collect distinct product names
    product_names = list({h.product_name for h in holdings})

    # Fetch matching master records in one query
    master_result = await db.execute(
        select(ProductMaster).where(ProductMaster.product_name.in_(product_names))
    )
    master_rows = master_result.scalars().all()
    master_map: dict[str, ProductMaster] = {m.product_name: m for m in master_rows}

    updated_count = 0
    not_found: list[str] = []

    for holding in holdings:
        master = master_map.get(holding.product_name)
        if master:
            holding.risk_level = master.risk_level
            holding.region = master.region
            if master.product_code:
                holding.product_code = master.product_code
            updated_count += 1
        else:
            if holding.product_name not in not_found:
                not_found.append(holding.product_name)

    if updated_count:
        await db.commit()

    return {"updated": updated_count, "not_found": not_found}


async def delete_snapshot(db: AsyncSession, snapshot_id: str) -> bool:
    """Delete a snapshot and all its holdings. Returns True if deleted, False if not found."""
    result = await db.execute(
        select(PortfolioSnapshot).where(PortfolioSnapshot.id == snapshot_id)
    )
    snapshot = result.scalar_one_or_none()
    if snapshot is None:
        return False

    # Delete holdings first (cascade may handle this, but explicit is safer)
    holdings_result = await db.execute(
        select(PortfolioHolding).where(PortfolioHolding.snapshot_id == snapshot_id)
    )
    for holding in holdings_result.scalars().all():
        await db.delete(holding)

    await db.delete(snapshot)
    await db.commit()
    return True
