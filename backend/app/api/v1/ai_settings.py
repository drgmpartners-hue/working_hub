"""AI API settings endpoints."""
from typing import Annotated, List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.core.deps import CurrentUser
from app.core.security import encrypt_api_key, decrypt_api_key, mask_api_key
from app.models.ai_setting import AIAPISetting
from app.schemas.ai_setting import AISettingResponse, AISettingUpdate

router = APIRouter(prefix="/settings", tags=["ai-settings"])


def _to_response(setting: AIAPISetting) -> AISettingResponse:
    """Convert an ORM instance to the public response schema."""
    try:
        plain_key = decrypt_api_key(setting.api_key_encrypted)
    except Exception:
        # If decryption fails (e.g. legacy data), fall back to a safe mask.
        plain_key = ""

    masked = mask_api_key(plain_key) if plain_key else "sk-...????"

    return AISettingResponse(
        id=setting.id,
        provider=setting.provider,
        api_key_masked=masked,
        is_active=setting.is_active,
    )


@router.get("/ai", response_model=List[AISettingResponse])
async def list_ai_settings(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> List[AISettingResponse]:
    """Return all AI API settings with api_key masked."""
    result = await db.execute(select(AIAPISetting))
    settings_list = result.scalars().all()
    return [_to_response(s) for s in settings_list]


@router.put("/ai", response_model=AISettingResponse)
async def upsert_ai_setting(
    payload: AISettingUpdate,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AISettingResponse:
    """Create or update the AI API setting for the given provider.

    If a record with the same provider already exists it is updated;
    otherwise a new record is created.
    """
    result = await db.execute(
        select(AIAPISetting).where(AIAPISetting.provider == payload.provider)
    )
    setting = result.scalar_one_or_none()

    encrypted = encrypt_api_key(payload.api_key)

    if setting is None:
        setting = AIAPISetting(
            provider=payload.provider,
            api_key_encrypted=encrypted,
            is_active=payload.is_active,
        )
        db.add(setting)
    else:
        setting.api_key_encrypted = encrypted
        setting.is_active = payload.is_active

    await db.commit()
    await db.refresh(setting)
    return _to_response(setting)
