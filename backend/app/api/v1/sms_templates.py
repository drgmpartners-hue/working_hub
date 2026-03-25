"""SMS Templates — each user manages their own reusable SMS message templates."""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.session import get_db
from app.core.deps import get_current_user
from app.models.sms_template import SmsTemplate

router = APIRouter(prefix="/sms-templates", tags=["sms-templates"])


# --- Schemas ---

class SmsTemplateCreate(BaseModel):
    name: str
    text: str


class SmsTemplateUpdate(BaseModel):
    name: str | None = None
    text: str | None = None


class SmsTemplateResponse(BaseModel):
    id: str
    name: str
    text: str
    created_at: str
    updated_at: str


def _to_response(t: SmsTemplate) -> SmsTemplateResponse:
    return SmsTemplateResponse(
        id=t.id,
        name=t.name,
        text=t.text,
        created_at=t.created_at.isoformat(),
        updated_at=t.updated_at.isoformat(),
    )


# --- Endpoints ---

@router.get("", response_model=list[SmsTemplateResponse])
async def list_sms_templates(
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all SMS templates for the current user."""
    result = await db.execute(
        select(SmsTemplate)
        .where(SmsTemplate.user_id == current_user.id)
        .order_by(SmsTemplate.created_at)
    )
    templates = result.scalars().all()
    return [_to_response(t) for t in templates]


@router.post("", response_model=SmsTemplateResponse, status_code=201)
async def create_sms_template(
    body: SmsTemplateCreate,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new SMS template for the current user."""
    template = SmsTemplate(
        user_id=current_user.id,
        name=body.name,
        text=body.text,
    )
    db.add(template)
    await db.commit()
    await db.refresh(template)
    return _to_response(template)


@router.put("/{template_id}", response_model=SmsTemplateResponse)
async def update_sms_template(
    template_id: str,
    body: SmsTemplateUpdate,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update an SMS template. Only the owning user can update."""
    result = await db.execute(
        select(SmsTemplate).where(
            SmsTemplate.id == template_id,
            SmsTemplate.user_id == current_user.id,
        )
    )
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(404, "SMS template not found")

    if body.name is not None:
        template.name = body.name
    if body.text is not None:
        template.text = body.text

    await db.commit()
    await db.refresh(template)
    return _to_response(template)


@router.delete("/{template_id}", status_code=204)
async def delete_sms_template(
    template_id: str,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete an SMS template. Only the owning user can delete."""
    result = await db.execute(
        select(SmsTemplate).where(
            SmsTemplate.id == template_id,
            SmsTemplate.user_id == current_user.id,
        )
    )
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(404, "SMS template not found")

    await db.delete(template)
    await db.commit()
