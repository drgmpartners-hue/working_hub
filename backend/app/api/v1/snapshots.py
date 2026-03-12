"""Snapshots API - portfolio snapshot management with Gemini Vision."""
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional
from datetime import date
from app.db.session import get_db
from app.core.deps import CurrentUser
from app.schemas.snapshot import SnapshotResponse, SnapshotListItem
from app.services import snapshot_service, client_service

router = APIRouter(prefix="/snapshots", tags=["snapshots"])


@router.post("", response_model=SnapshotResponse, status_code=201)
async def create_snapshot(
    client_account_id: str = Form(...),
    snapshot_date: date = Form(...),
    image: UploadFile = File(...),
    current_user=Depends(CurrentUser),
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
    current_user=Depends(CurrentUser),
    db: AsyncSession = Depends(get_db),
):
    return await snapshot_service.list_snapshots(db, account_id, date_from, date_to)


@router.get("/report")
async def get_report_data(
    account_id: str,
    target_date: Optional[date] = None,
    current_user=Depends(CurrentUser),
    db: AsyncSession = Depends(get_db),
):
    data = await snapshot_service.get_report_data(db, account_id, target_date)
    if not data:
        raise HTTPException(status_code=404, detail="No snapshot found")
    return data


@router.get("/{snapshot_id}", response_model=SnapshotResponse)
async def get_snapshot(
    snapshot_id: str,
    current_user=Depends(CurrentUser),
    db: AsyncSession = Depends(get_db),
):
    snapshot = await snapshot_service.get_snapshot_with_holdings(db, snapshot_id)
    if not snapshot:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    return snapshot
