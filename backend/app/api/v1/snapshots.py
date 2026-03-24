"""Snapshots API - portfolio snapshot management with Gemini Vision."""
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional, Annotated
from datetime import date
from app.db.session import get_db
from app.core.deps import CurrentUser, get_current_user
from app.schemas.snapshot import (
    SnapshotResponse,
    SnapshotListItem,
    HoldingUpdateRequest,
    HoldingResponse,
    ApplyMasterResponse,
    SnapshotHistoryResponse,
    SnapshotHistoryItem,
)
from app.services import snapshot_service, client_service

router = APIRouter(prefix="/snapshots", tags=["snapshots"])


@router.post("", response_model=SnapshotResponse, status_code=201)
async def create_snapshot(
    client_account_id: str = Form(...),
    snapshot_date: date = Form(...),
    image: UploadFile = File(...),
    current_user = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Upload image, extract with Gemini Vision, save snapshot."""
    image_bytes = await image.read()
    mime_type = image.content_type or "image/png"
    snapshot = await snapshot_service.create_snapshot(
        db, client_account_id, image_bytes, mime_type, snapshot_date
    )
    result = await snapshot_service.get_snapshot_with_holdings(db, snapshot.id)
    return result


@router.get("", response_model=list[SnapshotListItem])
async def list_snapshots(
    account_id: str,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    current_user = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await snapshot_service.list_snapshots(db, account_id, date_from, date_to)


@router.get("/history", response_model=SnapshotHistoryResponse)
async def get_snapshot_history(
    account_id: str,
    period: Optional[str] = None,
    current_user = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return snapshot history with region/risk weight breakdown for chart rendering.

    - period: 3m | 6m | 1y (omit for all history)
    """
    if period is not None and period not in ("3m", "6m", "1y"):
        from fastapi import HTTPException as _HTTPException
        raise _HTTPException(
            status_code=422,
            detail="period must be one of: 3m, 6m, 1y",
        )
    raw_items = await snapshot_service.get_history_with_weights(db, account_id, period)
    items = [SnapshotHistoryItem(**item) for item in raw_items]
    return SnapshotHistoryResponse(account_id=account_id, period=period, items=items)


@router.get("/report")
async def get_report_data(
    account_id: str,
    target_date: Optional[date] = None,
    current_user = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    data = await snapshot_service.get_report_data(db, account_id, target_date)
    if not data:
        raise HTTPException(status_code=404, detail="No snapshot found")
    return data


@router.get("/{snapshot_id}", response_model=SnapshotResponse)
async def get_snapshot(
    snapshot_id: str,
    current_user = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    snapshot = await snapshot_service.get_snapshot_with_holdings(db, snapshot_id)
    if not snapshot:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    return snapshot


@router.put(
    "/{snapshot_id}/holdings/{holding_id}",
    response_model=HoldingResponse,
)
async def update_holding(
    snapshot_id: str,
    holding_id: str,
    body: HoldingUpdateRequest,
    current_user = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Manually update mutable fields (risk_level, region, amounts, etc.)
    on a single holding that belongs to the given snapshot."""
    holding = await snapshot_service.update_holding(db, snapshot_id, holding_id, body)
    if holding is None:
        raise HTTPException(
            status_code=404,
            detail="Holding not found or does not belong to this snapshot",
        )
    return holding


@router.post(
    "/{snapshot_id}/holdings",
    response_model=HoldingResponse,
    status_code=201,
)
async def create_holding(
    snapshot_id: str,
    body: dict,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Manually add a new holding to a snapshot."""
    from app.models.snapshot import PortfolioSnapshot, PortfolioHolding
    from sqlalchemy import select
    import uuid

    result = await db.execute(select(PortfolioSnapshot).where(PortfolioSnapshot.id == snapshot_id))
    snapshot = result.scalar_one_or_none()
    if not snapshot:
        raise HTTPException(status_code=404, detail="Snapshot not found")

    holding = PortfolioHolding(
        id=str(uuid.uuid4()),
        snapshot_id=snapshot_id,
        product_name=body.get("product_name", ""),
        product_code=body.get("product_code"),
        product_type=body.get("product_type"),
        risk_level=body.get("risk_level"),
        region=body.get("region"),
        quantity=body.get("quantity"),
        purchase_price=body.get("purchase_price"),
        current_price=body.get("current_price"),
        purchase_amount=body.get("purchase_amount"),
        evaluation_amount=body.get("evaluation_amount"),
        total_deposit=body.get("total_deposit"),
        total_withdrawal=body.get("total_withdrawal"),
        return_amount=body.get("return_amount"),
        return_rate=body.get("return_rate"),
        seq=body.get("seq"),
    )
    db.add(holding)
    await db.commit()
    await db.refresh(holding)
    return holding


@router.post(
    "/{snapshot_id}/holdings/apply-master",
    response_model=ApplyMasterResponse,
)
async def apply_master(
    snapshot_id: str,
    current_user = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Apply risk_level and region from the product_master table to every
    holding in the given snapshot, matching by product_name."""
    # Verify snapshot exists
    snapshot = await snapshot_service.get_snapshot_with_holdings(db, snapshot_id)
    if not snapshot:
        raise HTTPException(status_code=404, detail="Snapshot not found")

    try:
        result = await snapshot_service.apply_master_to_snapshot(db, snapshot_id)
    except ImportError as exc:
        raise HTTPException(
            status_code=503,
            detail=str(exc),
        ) from exc

    return result


@router.patch("/{snapshot_id}")
async def patch_snapshot(
    snapshot_id: str,
    body: dict,
    _current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update snapshot metadata (e.g. snapshot_date)."""
    from app.models.snapshot import PortfolioSnapshot
    from sqlalchemy import select
    result = await db.execute(select(PortfolioSnapshot).where(PortfolioSnapshot.id == snapshot_id))
    snapshot = result.scalar_one_or_none()
    if not snapshot:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    if "snapshot_date" in body:
        from datetime import date as date_type, datetime
        val = body["snapshot_date"]
        if isinstance(val, str):
            snapshot.snapshot_date = datetime.strptime(val, "%Y-%m-%d").date()
        elif isinstance(val, date_type):
            snapshot.snapshot_date = val
    if "deposit_amount" in body:
        snapshot.deposit_amount = body["deposit_amount"]
    if "total_purchase" in body:
        snapshot.total_purchase = body["total_purchase"]
    if "total_evaluation" in body:
        snapshot.total_evaluation = body["total_evaluation"]
    if "total_return" in body:
        snapshot.total_return = body["total_return"]
    if "total_return_rate" in body:
        snapshot.total_return_rate = body["total_return_rate"]
    await db.commit()
    await db.refresh(snapshot)
    return {"id": snapshot.id, "snapshot_date": str(snapshot.snapshot_date)}


@router.delete("/{snapshot_id}", status_code=204)
async def delete_snapshot(
    snapshot_id: str,
    _current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a snapshot and all its holdings."""
    deleted = await snapshot_service.delete_snapshot(db, snapshot_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Snapshot not found")
