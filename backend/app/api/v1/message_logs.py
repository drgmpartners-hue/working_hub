"""Message logs — stores and retrieves SMS/link sending history."""
import os
import uuid
from datetime import datetime, date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_

from app.db.session import get_db
from app.core.deps import get_current_user
from app.models.message_log import MessageLog
from app.models.client import Client, ClientAccount

router = APIRouter(prefix="/message-logs", tags=["message-logs"])

UPLOAD_DIR = "uploads/message-logs"


# --- Schemas ---

class MessageLogResponse(BaseModel):
    id: str
    client_id: str
    client_name: str
    client_account_id: Optional[str] = None
    account_type: Optional[str] = None
    account_number: Optional[str] = None
    securities_company: Optional[str] = None
    message_type: str
    message_summary: str
    message_text: Optional[str] = None
    has_image: bool
    sent_at: str
    created_at: str


class MessageLogListResponse(BaseModel):
    items: list[MessageLogResponse]
    total: int


# --- Helpers ---

def _ensure_upload_dir(sub: str = "") -> str:
    path = os.path.join(UPLOAD_DIR, sub) if sub else UPLOAD_DIR
    os.makedirs(path, exist_ok=True)
    return path


# --- Endpoints ---

@router.get("", response_model=MessageLogListResponse)
async def list_message_logs(
    client_id: Optional[str] = None,
    account_id: Optional[str] = None,
    securities_company: Optional[str] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    limit: int = 100,
    offset: int = 0,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List message logs with optional filters."""
    conditions = [MessageLog.user_id == current_user.id]

    if client_id:
        conditions.append(MessageLog.client_id == client_id)
    if account_id:
        conditions.append(MessageLog.client_account_id == account_id)
    if date_from:
        conditions.append(MessageLog.sent_at >= datetime.combine(date_from, datetime.min.time()))
    if date_to:
        conditions.append(MessageLog.sent_at <= datetime.combine(date_to, datetime.max.time()))

    # Base query
    base_q = select(MessageLog).where(and_(*conditions))

    # If filtering by securities_company, join with ClientAccount
    if securities_company:
        base_q = base_q.join(
            ClientAccount, MessageLog.client_account_id == ClientAccount.id, isouter=True
        ).where(ClientAccount.securities_company == securities_company)

    # Count
    from sqlalchemy import func
    count_q = select(func.count()).select_from(base_q.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    # Fetch with pagination
    result = await db.execute(
        base_q.order_by(MessageLog.sent_at.desc()).offset(offset).limit(limit)
    )
    logs = result.scalars().all()

    # Gather client/account info
    items = []
    for log in logs:
        # Get client name
        client_res = await db.execute(
            select(Client.name).where(Client.id == log.client_id)
        )
        client_name = client_res.scalar() or "알 수 없음"

        # Get account info
        account_type = None
        account_number = None
        sec_company = None
        if log.client_account_id:
            acct_res = await db.execute(
                select(ClientAccount).where(ClientAccount.id == log.client_account_id)
            )
            acct = acct_res.scalar_one_or_none()
            if acct:
                account_type = acct.account_type
                account_number = acct.account_number
                sec_company = acct.securities_company

        items.append(MessageLogResponse(
            id=log.id,
            client_id=log.client_id,
            client_name=client_name,
            client_account_id=log.client_account_id,
            account_type=account_type,
            account_number=account_number,
            securities_company=sec_company,
            message_type=log.message_type,
            message_summary=log.message_summary,
            message_text=log.message_text,
            has_image=bool(log.image_path),
            sent_at=log.sent_at.isoformat(),
            created_at=log.created_at.isoformat(),
        ))

    return MessageLogListResponse(items=items, total=total)


@router.post("", response_model=MessageLogResponse, status_code=201)
async def create_message_log(
    client_id: str = Form(...),
    message_type: str = Form(...),
    message_summary: str = Form(...),
    client_account_id: Optional[str] = Form(None),
    message_text: Optional[str] = Form(None),
    sent_at: Optional[str] = Form(None),
    image: Optional[UploadFile] = File(None),
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a message log entry with optional image upload."""
    # Normalize empty strings to None
    if client_account_id is not None and client_account_id.strip() == '':
        client_account_id = None

    # Validate client belongs to user
    client_res = await db.execute(
        select(Client).where(Client.id == client_id, Client.user_id == current_user.id)
    )
    client = client_res.scalar_one_or_none()
    if not client:
        raise HTTPException(404, "Client not found")

    # Save image if provided
    image_path = None
    if image and image.filename:
        now = datetime.utcnow()
        sub_dir = _ensure_upload_dir(f"{now.year}/{now.month:02d}")
        ext = os.path.splitext(image.filename)[1] or ".png"
        filename = f"{uuid.uuid4()}{ext}"
        full_path = os.path.join(sub_dir, filename)
        content = await image.read()
        with open(full_path, "wb") as f:
            f.write(content)
        image_path = full_path

    parsed_sent_at = datetime.utcnow()
    if sent_at:
        try:
            # Handle 'Z' suffix and strip timezone info for naive datetime column
            clean = sent_at.replace('Z', '+00:00')
            parsed = datetime.fromisoformat(clean)
            parsed_sent_at = parsed.replace(tzinfo=None)
        except ValueError:
            pass

    log = MessageLog(
        user_id=current_user.id,
        client_id=client_id,
        client_account_id=client_account_id or None,
        message_type=message_type,
        message_summary=message_summary[:200],
        message_text=message_text,
        image_path=image_path,
        sent_at=parsed_sent_at,
    )
    db.add(log)
    await db.commit()
    await db.refresh(log)

    # Account info
    account_type = None
    account_number = None
    sec_company = None
    if log.client_account_id:
        acct_res = await db.execute(
            select(ClientAccount).where(ClientAccount.id == log.client_account_id)
        )
        acct = acct_res.scalar_one_or_none()
        if acct:
            account_type = acct.account_type
            account_number = acct.account_number
            sec_company = acct.securities_company

    return MessageLogResponse(
        id=log.id,
        client_id=log.client_id,
        client_name=client.name,
        client_account_id=log.client_account_id,
        account_type=account_type,
        account_number=account_number,
        securities_company=sec_company,
        message_type=log.message_type,
        message_summary=log.message_summary,
        message_text=log.message_text,
        has_image=bool(log.image_path),
        sent_at=log.sent_at.isoformat(),
        created_at=log.created_at.isoformat(),
    )


class MessageLogUpdate(BaseModel):
    message_type: Optional[str] = None
    message_summary: Optional[str] = None
    message_text: Optional[str] = None
    sent_at: Optional[str] = None


@router.put("/{log_id}", response_model=MessageLogResponse)
async def update_message_log(
    log_id: str,
    body: MessageLogUpdate,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update a message log entry (summary, text, sent_at)."""
    result = await db.execute(
        select(MessageLog).where(
            MessageLog.id == log_id,
            MessageLog.user_id == current_user.id,
        )
    )
    log = result.scalar_one_or_none()
    if not log:
        raise HTTPException(404, "Message log not found")

    if body.message_type is not None:
        log.message_type = body.message_type
    if body.message_summary is not None:
        log.message_summary = body.message_summary[:200]
    if body.message_text is not None:
        log.message_text = body.message_text
    if body.sent_at is not None:
        try:
            clean = body.sent_at.replace('Z', '+00:00')
            parsed = datetime.fromisoformat(clean)
            log.sent_at = parsed.replace(tzinfo=None)
        except ValueError:
            pass

    await db.commit()
    await db.refresh(log)

    client_res = await db.execute(select(Client.name).where(Client.id == log.client_id))
    client_name = client_res.scalar() or "알 수 없음"
    account_type = account_number = sec_company = None
    if log.client_account_id:
        acct_res = await db.execute(select(ClientAccount).where(ClientAccount.id == log.client_account_id))
        acct = acct_res.scalar_one_or_none()
        if acct:
            account_type = acct.account_type
            account_number = acct.account_number
            sec_company = acct.securities_company

    return MessageLogResponse(
        id=log.id,
        client_id=log.client_id,
        client_name=client_name,
        client_account_id=log.client_account_id,
        account_type=account_type,
        account_number=account_number,
        securities_company=sec_company,
        message_type=log.message_type,
        message_summary=log.message_summary,
        message_text=log.message_text,
        has_image=bool(log.image_path),
        sent_at=log.sent_at.isoformat(),
        created_at=log.created_at.isoformat(),
    )


@router.get("/{log_id}/image")
async def get_message_log_image(
    log_id: str,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Download the stored report image for a message log."""
    result = await db.execute(
        select(MessageLog).where(
            MessageLog.id == log_id,
            MessageLog.user_id == current_user.id,
        )
    )
    log = result.scalar_one_or_none()
    if not log:
        raise HTTPException(404, "Message log not found")
    if not log.image_path or not os.path.exists(log.image_path):
        raise HTTPException(404, "Image not found")

    return FileResponse(
        log.image_path,
        media_type="image/png",
        filename=f"report_{log.id}.png",
    )


@router.delete("/{log_id}", status_code=204)
async def delete_message_log(
    log_id: str,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a message log entry."""
    result = await db.execute(
        select(MessageLog).where(
            MessageLog.id == log_id,
            MessageLog.user_id == current_user.id,
        )
    )
    log = result.scalar_one_or_none()
    if not log:
        raise HTTPException(404, "Message log not found")

    # Remove image file if exists
    if log.image_path and os.path.exists(log.image_path):
        try:
            os.remove(log.image_path)
        except OSError:
            pass

    await db.delete(log)
    await db.commit()


@router.post("/cleanup", status_code=200)
async def cleanup_old_images(
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete images older than 1 year from message logs."""
    one_year_ago = datetime.utcnow() - timedelta(days=365)
    result = await db.execute(
        select(MessageLog).where(
            and_(
                MessageLog.user_id == current_user.id,
                MessageLog.image_path.isnot(None),
                MessageLog.sent_at < one_year_ago,
            )
        )
    )
    old_logs = result.scalars().all()
    cleaned = 0
    for log in old_logs:
        if log.image_path and os.path.exists(log.image_path):
            try:
                os.remove(log.image_path)
                cleaned += 1
            except OSError:
                pass
        log.image_path = None
    await db.commit()
    return {"cleaned_images": cleaned, "total_checked": len(old_logs)}
