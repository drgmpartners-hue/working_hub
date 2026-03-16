"""Call reservations API — employee-facing endpoints."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.db.session import get_db
from app.models.call_reservation import CallReservation
from app.schemas.call_reservation import (
    CallReservationListItem,
    CallReservationListResponse,
    CallReservationUpdateRequest,
    CallReservationUpdateResponse,
)

router = APIRouter(prefix="/call-reservations", tags=["call-reservations"])


@router.get("", response_model=CallReservationListResponse)
async def list_call_reservations(
    status: Optional[str] = None,
    current_user=Depends(CurrentUser),
    db: AsyncSession = Depends(get_db),
):
    """Return all call reservations, optionally filtered by status.

    status query param accepts: pending | confirmed | completed
    """
    query = select(CallReservation).order_by(CallReservation.created_at.desc())
    if status:
        query = query.where(CallReservation.status == status)

    result = await db.execute(query)
    reservations = result.scalars().all()

    items = [CallReservationListItem.model_validate(r) for r in reservations]
    return CallReservationListResponse(items=items, total=len(items))


@router.put("/{reservation_id}", response_model=CallReservationUpdateResponse)
async def update_call_reservation(
    reservation_id: str,
    body: CallReservationUpdateRequest,
    current_user=Depends(CurrentUser),
    db: AsyncSession = Depends(get_db),
):
    """Update the status of a call reservation (confirmed / completed)."""
    result = await db.execute(
        select(CallReservation).where(CallReservation.id == reservation_id)
    )
    reservation = result.scalar_one_or_none()
    if not reservation:
        raise HTTPException(status_code=404, detail="Reservation not found")

    reservation.status = body.status
    await db.commit()
    await db.refresh(reservation)

    return CallReservationUpdateResponse(id=reservation.id, status=reservation.status)
