"""Solapi messaging service — SMS/LMS 발송."""
import time
import uuid
import hmac
import hashlib
import logging
from typing import Optional

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

SOLAPI_BASE = "https://api.solapi.com"


def _make_auth_header() -> str:
    """Generate HMAC-SHA256 auth header for Solapi API."""
    date = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    salt = str(uuid.uuid4())
    data = date + salt
    signature = hmac.new(
        settings.SOLAPI_API_SECRET.encode(), data.encode(), hashlib.sha256
    ).hexdigest()
    return f"HMAC-SHA256 apiKey={settings.SOLAPI_API_KEY}, date={date}, salt={salt}, signature={signature}"


async def send_sms(
    to: str,
    text: str,
    sender: Optional[str] = None,
) -> dict:
    """Send SMS/LMS to a single recipient.

    Args:
        to: 수신자 전화번호 (010-1234-5678 or 01012345678)
        text: 메시지 내용 (90바이트 초과 시 자동 LMS)
        sender: 발신번호 (없으면 settings.SOLAPI_SENDER 사용)

    Returns:
        API response dict
    """
    if not settings.SOLAPI_API_KEY or not settings.SOLAPI_API_SECRET:
        logger.warning("Solapi API key not configured")
        return {"success": False, "error": "솔라피 API Key가 설정되지 않았습니다."}

    from_number = (sender or settings.SOLAPI_SENDER).replace("-", "")
    if not from_number:
        return {"success": False, "error": "발신번호가 설정되지 않았습니다."}

    phone = to.replace("-", "").replace(" ", "")
    auth = _make_auth_header()

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
    recipients: list[dict],
    sender: Optional[str] = None,
) -> dict:
    """Send SMS to multiple recipients.

    Args:
        recipients: [{"to": "010-1234-5678", "text": "메시지 내용"}, ...]
        sender: 발신번호

    Returns:
        API response dict
    """
    if not settings.SOLAPI_API_KEY or not settings.SOLAPI_API_SECRET:
        return {"success": False, "error": "솔라피 API Key가 설정되지 않았습니다."}

    from_number = (sender or settings.SOLAPI_SENDER).replace("-", "")
    if not from_number:
        return {"success": False, "error": "발신번호가 설정되지 않았습니다."}

    auth = _make_auth_header()

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


async def get_balance() -> dict:
    """Check Solapi account balance."""
    if not settings.SOLAPI_API_KEY:
        return {"error": "API Key 미설정"}
    auth = _make_auth_header()
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.get(
                f"{SOLAPI_BASE}/cash/v1/balance",
                headers={"Authorization": auth},
            )
        return res.json() if res.status_code == 200 else {"error": res.text}
    except Exception as e:
        return {"error": str(e)}
