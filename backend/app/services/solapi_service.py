"""Solapi messaging service — SMS/LMS 발송.

API 키는 DB(user_api_keys 테이블)에서 자동으로 가져옵니다.
누가 로그인하든 발송 가능합니다.
"""
import uuid
import hmac
import hashlib
import logging
import base64
from datetime import datetime
from typing import Optional

import httpx
from cryptography.fernet import Fernet
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings

logger = logging.getLogger(__name__)

SOLAPI_BASE = "https://api.solapi.com"

# Fernet key (settings.SECRET_KEY 기반 — user_api_keys 암호화와 동일)
_raw = hashlib.sha256(settings.SECRET_KEY.encode()).digest()
_fernet = Fernet(base64.urlsafe_b64encode(_raw))


def _decrypt(value: str) -> str:
    return _fernet.decrypt(value.encode()).decode()


async def _get_solapi_keys(db: AsyncSession) -> tuple[str, str, str]:
    """DB에서 솔라피 API 키를 가져옵니다 (어떤 유저든 등록한 키 사용)."""
    from app.models.user_api_key import UserApiKey

    result = await db.execute(
        select(UserApiKey).where(
            UserApiKey.provider == "solapi",
            UserApiKey.is_active == True,
        ).limit(1)
    )
    key = result.scalar_one_or_none()
    if not key:
        return "", "", ""

    api_key = _decrypt(key.api_key)
    api_secret = _decrypt(key.api_secret) if key.api_secret else ""
    return api_key, api_secret, settings.SOLAPI_SENDER


def _make_auth_header(api_key: str, api_secret: str) -> str:
    """Generate HMAC-SHA256 auth header for Solapi API."""
    date = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.000Z")
    salt = str(uuid.uuid4())
    data = date + salt
    signature = hmac.new(
        api_secret.encode(), data.encode(), hashlib.sha256
    ).hexdigest()
    return f"HMAC-SHA256 apiKey={api_key}, date={date}, salt={salt}, signature={signature}"


async def send_sms(
    db: AsyncSession,
    to: str,
    text: str,
    sender: Optional[str] = None,
) -> dict:
    """Send SMS/LMS to a single recipient. DB에서 솔라피 키를 자동으로 가져옵니다."""
    api_key, api_secret, default_sender = await _get_solapi_keys(db)
    if not api_key or not api_secret:
        return {"success": False, "error": "솔라피 API Key가 등록되지 않았습니다. 설정에서 등록해주세요."}

    from_number = (sender or default_sender).replace("-", "")
    if not from_number:
        return {"success": False, "error": "발신번호가 설정되지 않았습니다."}

    phone = to.replace("-", "").replace(" ", "")
    auth = _make_auth_header(api_key, api_secret)

    body = {
        "message": {
            "to": phone,
            "from": from_number,
            "text": text,
        },
    }

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            res = await client.post(
                f"{SOLAPI_BASE}/messages/v4/send",
                json=body,
                headers={"Authorization": auth, "Content-Type": "application/json"},
            )

        result = res.json() if res.status_code < 500 else {"error": res.text}

        if res.status_code >= 400:
            logger.error("Solapi SMS failed: %s %s", res.status_code, result)
            return {"success": False, "status_code": res.status_code, **result}

        logger.info("Solapi SMS sent to %s: %s", phone, result.get("groupId", ""))
        return {"success": True, "status_code": res.status_code, **result}

    except Exception as e:
        logger.error("Solapi SMS error: %s", e)
        return {"success": False, "error": str(e)}


async def send_bulk_sms(
    db: AsyncSession,
    recipients: list[dict],
    sender: Optional[str] = None,
) -> dict:
    """Send SMS to multiple recipients. DB에서 솔라피 키를 자동으로 가져옵니다."""
    api_key, api_secret, default_sender = await _get_solapi_keys(db)
    if not api_key or not api_secret:
        return {"success": False, "error": "솔라피 API Key가 등록되지 않았습니다."}

    from_number = (sender or default_sender).replace("-", "")
    if not from_number:
        return {"success": False, "error": "발신번호가 설정되지 않았습니다."}

    auth = _make_auth_header(api_key, api_secret)

    messages = []
    for r in recipients:
        phone = r["to"].replace("-", "").replace(" ", "")
        messages.append({
            "to": phone,
            "from": from_number,
            "text": r["text"],
        })

    body = {"messages": messages}

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            res = await client.post(
                f"{SOLAPI_BASE}/messages/v4/send-many",
                json=body,
                headers={"Authorization": auth, "Content-Type": "application/json"},
            )

        result = res.json() if res.status_code < 500 else {"error": res.text}

        if res.status_code >= 400:
            logger.error("Solapi bulk SMS failed: %s %s", res.status_code, result)
            return {"success": False, "status_code": res.status_code, **result}

        logger.info("Solapi bulk SMS sent: %d recipients", len(recipients))
        return {"success": True, "status_code": res.status_code, **result}

    except Exception as e:
        logger.error("Solapi bulk SMS error: %s", e)
        return {"success": False, "error": str(e)}


async def get_kakao_templates(db: AsyncSession) -> dict:
    """Fetch approved KakaoTalk 알림톡 templates from Solapi."""
    api_key, api_secret, _ = await _get_solapi_keys(db)
    if not api_key:
        return {"error": "API Key 미설정"}
    pf_id = settings.SOLAPI_PF_ID
    if not pf_id:
        return {"error": "카카오 채널 ID(SOLAPI_PF_ID)가 설정되지 않았습니다."}

    auth = _make_auth_header(api_key, api_secret)
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            res = await client.get(
                f"{SOLAPI_BASE}/kakao/v2/templates",
                params={"status": "APPROVED", "limit": "100"},
                headers={"Authorization": auth},
            )
        if res.status_code >= 400:
            logger.error("Solapi get templates failed: %s %s", res.status_code, res.text)
            return {"error": f"템플릿 조회 실패 ({res.status_code})"}
        return res.json()
    except Exception as e:
        logger.error("Solapi get templates error: %s", e)
        return {"error": str(e)}


async def send_alimtalk(
    db: AsyncSession,
    to: str,
    template_id: str,
    variables: dict[str, str],
    fallback_text: str = "",
    sender: Optional[str] = None,
) -> dict:
    """Send KakaoTalk 알림톡 to a single recipient via Solapi."""
    api_key, api_secret, default_sender = await _get_solapi_keys(db)
    if not api_key or not api_secret:
        return {"success": False, "error": "솔라피 API Key가 등록되지 않았습니다."}

    pf_id = settings.SOLAPI_PF_ID
    if not pf_id:
        return {"success": False, "error": "카카오 채널 ID(SOLAPI_PF_ID)가 설정되지 않았습니다."}

    from_number = (sender or default_sender).replace("-", "")
    if not from_number:
        return {"success": False, "error": "발신번호가 설정되지 않았습니다."}

    phone = to.replace("-", "").replace(" ", "")
    auth = _make_auth_header(api_key, api_secret)

    message: dict = {
        "to": phone,
        "from": from_number,
        "kakaoOptions": {
            "pfId": pf_id,
            "templateId": template_id,
            "variables": variables,
            "disableSms": False,
        },
    }
    # SMS 대체 발송용 텍스트 (알림톡 실패 시)
    if fallback_text:
        message["text"] = fallback_text

    body = {"message": message}

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            res = await client.post(
                f"{SOLAPI_BASE}/messages/v4/send",
                json=body,
                headers={"Authorization": auth, "Content-Type": "application/json"},
            )

        result = res.json() if res.status_code < 500 else {"error": res.text}

        if res.status_code >= 400:
            logger.error("Solapi 알림톡 failed: %s %s", res.status_code, result)
            return {"success": False, "status_code": res.status_code, **result}

        logger.info("Solapi 알림톡 sent to %s: %s", phone, result.get("groupId", ""))
        return {"success": True, "status_code": res.status_code, **result}

    except Exception as e:
        logger.error("Solapi 알림톡 error: %s", e)
        return {"success": False, "error": str(e)}


async def get_balance(db: AsyncSession) -> dict:
    """Check Solapi account balance."""
    api_key, api_secret, _ = await _get_solapi_keys(db)
    if not api_key:
        return {"error": "API Key 미설정"}
    auth = _make_auth_header(api_key, api_secret)
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.get(
                f"{SOLAPI_BASE}/cash/v1/balance",
                headers={"Authorization": auth},
            )
        return res.json() if res.status_code == 200 else {"error": res.text}
    except Exception as e:
        return {"error": str(e)}
