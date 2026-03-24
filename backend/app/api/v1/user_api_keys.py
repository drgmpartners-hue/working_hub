"""User API Keys — each user manages their own external API keys."""
from typing import Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from cryptography.fernet import Fernet
import base64
import hashlib
import httpx

from app.db.session import get_db
from app.core.config import settings
from app.core.deps import get_current_user
from app.models.user_api_key import UserApiKey

router = APIRouter(prefix="/user-api-keys", tags=["user-api-keys"])

# Derive a Fernet key from SECRET_KEY (deterministic, 32-byte base64)
_raw = hashlib.sha256(settings.SECRET_KEY.encode()).digest()
_fernet = Fernet(base64.urlsafe_b64encode(_raw))


def _encrypt(value: str) -> str:
    return _fernet.encrypt(value.encode()).decode()


def _decrypt(value: str) -> str:
    return _fernet.decrypt(value.encode()).decode()


def _mask(value: str) -> str:
    """Show first 4 and last 4 chars, mask middle."""
    if len(value) <= 10:
        return value[:2] + "*" * (len(value) - 2)
    return value[:4] + "*" * (len(value) - 8) + value[-4:]


# --- Schemas ---

VALID_PROVIDERS = ["kiwoom", "claude", "gemini", "solapi"]


class ApiKeyCreate(BaseModel):
    provider: str  # 'kiwoom', 'claude', 'gemini'
    api_key: str
    api_secret: Optional[str] = None


class ApiKeyUpdate(BaseModel):
    api_key: Optional[str] = None
    api_secret: Optional[str] = None
    is_active: Optional[bool] = None


class ApiKeyResponse(BaseModel):
    id: str
    provider: str
    api_key_masked: str
    api_secret_masked: Optional[str]
    is_active: bool
    last_verified_at: Optional[str]
    created_at: str
    updated_at: str


# --- Endpoints ---

@router.get("", response_model=list[ApiKeyResponse])
async def list_api_keys(
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all API keys for the current user (masked)."""
    result = await db.execute(
        select(UserApiKey)
        .where(UserApiKey.user_id == current_user.id)
        .order_by(UserApiKey.provider)
    )
    keys = result.scalars().all()
    return [
        ApiKeyResponse(
            id=k.id,
            provider=k.provider,
            api_key_masked=_mask(_decrypt(k.api_key)),
            api_secret_masked=_mask(_decrypt(k.api_secret)) if k.api_secret else None,
            is_active=k.is_active,
            last_verified_at=k.last_verified_at.isoformat() if k.last_verified_at else None,
            created_at=k.created_at.isoformat(),
            updated_at=k.updated_at.isoformat(),
        )
        for k in keys
    ]


@router.post("", response_model=ApiKeyResponse, status_code=201)
async def create_api_key(
    body: ApiKeyCreate,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Register an API key for a provider."""
    if body.provider not in VALID_PROVIDERS:
        raise HTTPException(400, f"Invalid provider. Must be one of: {VALID_PROVIDERS}")

    # Check if already exists for this provider
    existing = await db.execute(
        select(UserApiKey).where(
            and_(
                UserApiKey.user_id == current_user.id,
                UserApiKey.provider == body.provider,
            )
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(409, f"API key for '{body.provider}' already exists. Use PUT to update.")

    key = UserApiKey(
        user_id=current_user.id,
        provider=body.provider,
        api_key=_encrypt(body.api_key),
        api_secret=_encrypt(body.api_secret) if body.api_secret else None,
    )
    db.add(key)
    await db.commit()
    await db.refresh(key)

    return ApiKeyResponse(
        id=key.id,
        provider=key.provider,
        api_key_masked=_mask(body.api_key),
        api_secret_masked=_mask(body.api_secret) if body.api_secret else None,
        is_active=key.is_active,
        last_verified_at=None,
        created_at=key.created_at.isoformat(),
        updated_at=key.updated_at.isoformat(),
    )


class TestResult(BaseModel):
    success: bool
    message: str


@router.post("/test/{provider}", response_model=TestResult)
async def test_api_key(
    provider: str,
    body: ApiKeyCreate,
    current_user=Depends(get_current_user),
):
    """Test an API key without saving it."""
    if provider not in VALID_PROVIDERS:
        raise HTTPException(400, f"Invalid provider: {provider}")

    try:
        if provider == "claude":
            return await _test_claude(body.api_key)
        elif provider == "gemini":
            return await _test_gemini(body.api_key)
        elif provider == "kiwoom":
            return await _test_kiwoom(body.api_key, body.api_secret or "")
        elif provider == "solapi":
            return await _test_solapi(body.api_key, body.api_secret or "")
    except Exception as e:
        return TestResult(success=False, message=f"테스트 중 오류: {str(e)}")


@router.put("/{provider}", response_model=ApiKeyResponse)
async def update_api_key(
    provider: str,
    body: ApiKeyUpdate,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update an API key for a provider."""
    result = await db.execute(
        select(UserApiKey).where(
            and_(
                UserApiKey.user_id == current_user.id,
                UserApiKey.provider == provider,
            )
        )
    )
    key = result.scalar_one_or_none()
    if not key:
        raise HTTPException(404, f"API key for '{provider}' not found")

    if body.api_key is not None:
        key.api_key = _encrypt(body.api_key)
    if body.api_secret is not None:
        key.api_secret = _encrypt(body.api_secret) if body.api_secret else None
    if body.is_active is not None:
        key.is_active = body.is_active

    await db.commit()
    await db.refresh(key)

    return ApiKeyResponse(
        id=key.id,
        provider=key.provider,
        api_key_masked=_mask(_decrypt(key.api_key)),
        api_secret_masked=_mask(_decrypt(key.api_secret)) if key.api_secret else None,
        is_active=key.is_active,
        last_verified_at=key.last_verified_at.isoformat() if key.last_verified_at else None,
        created_at=key.created_at.isoformat(),
        updated_at=key.updated_at.isoformat(),
    )


@router.delete("/{provider}", status_code=204)
async def delete_api_key(
    provider: str,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete an API key for a provider."""
    result = await db.execute(
        select(UserApiKey).where(
            and_(
                UserApiKey.user_id == current_user.id,
                UserApiKey.provider == provider,
            )
        )
    )
    key = result.scalar_one_or_none()
    if not key:
        raise HTTPException(404, f"API key for '{provider}' not found")

    await db.delete(key)
    await db.commit()


async def _test_claude(api_key: str) -> TestResult:
    """Test Claude API by calling models list endpoint."""
    async with httpx.AsyncClient(timeout=10) as client:
        res = await client.get(
            "https://api.anthropic.com/v1/models",
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
            },
        )
    if res.status_code == 200:
        data = res.json()
        model_count = len(data.get("data", []))
        return TestResult(success=True, message=f"연결 성공! {model_count}개 모델 사용 가능")
    elif res.status_code == 401:
        return TestResult(success=False, message="인증 실패: API 키가 올바르지 않습니다.")
    else:
        return TestResult(success=False, message=f"API 응답 오류 (status={res.status_code})")


async def _test_gemini(api_key: str) -> TestResult:
    """Test Gemini API by calling models list endpoint."""
    async with httpx.AsyncClient(timeout=10) as client:
        res = await client.get(
            f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}",
        )
    if res.status_code == 200:
        data = res.json()
        model_count = len(data.get("models", []))
        return TestResult(success=True, message=f"연결 성공! {model_count}개 모델 사용 가능")
    elif res.status_code == 400 or res.status_code == 403:
        return TestResult(success=False, message="인증 실패: API 키가 올바르지 않습니다.")
    else:
        return TestResult(success=False, message=f"API 응답 오류 (status={res.status_code})")


async def _test_kiwoom(app_key: str, app_secret: str) -> TestResult:
    """Test Kiwoom REST API by requesting an access token."""
    if not app_secret:
        return TestResult(success=False, message="APP Secret이 필요합니다.")
    async with httpx.AsyncClient(timeout=10) as client:
        res = await client.post(
            "https://rest.kiwoom.com/oauth2/token",
            json={
                "grant_type": "client_credentials",
                "appkey": app_key,
                "appsecret": app_secret,
            },
        )
    if res.status_code == 200:
        data = res.json()
        if data.get("access_token") or data.get("token"):
            return TestResult(success=True, message="연결 성공! 액세스 토큰 발급 확인됨")
        return TestResult(success=False, message=f"토큰 발급 실패: {data.get('msg', data.get('message', '알 수 없는 오류'))}")
    elif res.status_code == 401 or res.status_code == 403:
        return TestResult(success=False, message="인증 실패: APP Key 또는 APP Secret이 올바르지 않습니다.")
    else:
        return TestResult(success=False, message=f"API 응답 오류 (status={res.status_code})")


async def _test_solapi(api_key: str, api_secret: str) -> TestResult:
    """Test Solapi API by checking balance."""
    if not api_secret:
        return TestResult(success=False, message="API Secret이 필요합니다.")
    import time, hmac, hashlib
    timestamp = str(int(time.time() * 1000))
    signature = hmac.new(api_secret.encode(), timestamp.encode(), hashlib.sha256).hexdigest()
    auth_header = f"HMAC-SHA256 apiKey={api_key}, date={timestamp}, salt={timestamp}, signature={signature}"
    async with httpx.AsyncClient(timeout=10) as client:
        res = await client.get(
            "https://api.solapi.com/cash/v1/balance",
            headers={"Authorization": auth_header},
        )
    if res.status_code == 200:
        data = res.json()
        balance = data.get("balance", 0)
        return TestResult(success=True, message=f"연결 성공! 잔액: {balance}원")
    elif res.status_code == 401 or res.status_code == 403:
        return TestResult(success=False, message="인증 실패: API Key 또는 Secret이 올바르지 않습니다.")
    else:
        return TestResult(success=False, message=f"API 응답 오류 (status={res.status_code})")
