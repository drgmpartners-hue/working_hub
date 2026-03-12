"""Snapshot service - create/retrieve portfolio snapshots."""
import uuid
import os
from datetime import date
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from app.models.snapshot import PortfolioSnapshot, PortfolioHolding
from app.models.client import ClientAccount
from app.services.vision_service import extract_portfolio_from_image

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
        select(PortfolioSnapshot).where(PortfolioSnapshot.id == snapshot_id)
    )
    snapshot = result.scalar_one_or_none()
    if snapshot:
        # Load holdings
        holdings_result = await db.execute(
            select(PortfolioHolding)
            .where(PortfolioHolding.snapshot_id == snapshot_id)
            .order_by(PortfolioHolding.seq)
        )
        snapshot.holdings = holdings_result.scalars().all()
    return snapshot


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
