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
    """환경변수에서 솔라피 API 키를 가져옵니다."""
    logger.info("Solapi keys check: API_KEY=%s, SECRET=%s, SENDER=%s",
                settings.SOLAPI_API_KEY[:4] + "..." if settings.SOLAPI_API_KEY else "EMPTY",
                settings.SOLAPI_API_SECRET[:4] + "..." if settings.SOLAPI_API_SECRET else "EMPTY",
                settings.SOLAPI_SENDER or "EMPTY")
    return settings.SOLAPI_API_KEY, settings.SOLAPI_API_SECRET, settings.SOLAPI_SENDER


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


"""사전 등록된 알림톡 템플릿 목록 (솔라피 API 호출 대신 직접 관리)"""
APPROVED_TEMPLATES = [
    {
        "templateId": "KA01TP260401055157742n7hIaGeUMvv",
        "name": "수정 포트폴리오 안내",
        "content": "Dr.GM 연금저축/IRP 관리\n수정 포트폴리오 안내\n\n종합자산관리전문회사 Dr.GM에서\n#{고객명}#{고유번호}님께 안내드립니다.\n\n고객님께서 신청하신 투자권유대행 서비스에 따라 #{상품명} 포트폴리오 점검 결과를 안내해 드립니다.\n\n운용성과를 확인하시고, 추천 '수정 포트폴리오' 내역을 검토해 주시기 바랍니다.\n\n📢 안내사항\n- 링크 유지기간은 7일입니다.\n- 해당 링크는 웹화면에 최적화가 되어 있습니다.\n- 이름 뒤의 번호는 #{고객명}님의 고유번호입니다.",
        "buttons": [{"buttonType": "WL", "buttonName": "변경 제안 링크", "linkMo": "https://#{변경제안링크}", "linkPc": "https://#{변경제안링크}"}],
        "status": "APPROVED",
    },
    {
        "templateId": "KA01TP260401055335473NZNfQMTN0iJ",
        "name": "상시조회 페이지 개설 안내",
        "content": "Dr.GM 연금저축/IRP 관리\n상시조회 페이지 개설 안내\n\n종합자산관리전문회사 Dr.GM에서\n#{고객명}#{고유번호}님께 안내드립니다.\n\n고객님께서 요청하신 연금저축/IRP 운용현황 상시조회 페이지를 안내해 드리니 아래 버튼을 통해 운용내역을 확인해 보시기 바랍니다.\n\n📢 안내\n- 포트폴리오 수정 안내 링크는 별도로 발송될 예정입니다.\n- 해당 링크는 웹화면에 최적화가 되어 있습니다.\n- 이름 뒤의 번호는 #{고객명}님의 고유번호입니다.",
        "buttons": [{"buttonType": "WL", "buttonName": "상시조회페이지", "linkMo": "https://working-hub.vercel.app/client/#{상시조회링크}", "linkPc": "https://working-hub.vercel.app/client/#{상시조회링크}"}],
        "status": "APPROVED",
    },
]


async def get_kakao_templates(db: AsyncSession) -> dict:
    """사전 등록된 알림톡 템플릿 목록 반환 (IP 제한 우회)."""
    return {"templateList": APPROVED_TEMPLATES}


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
            "disableSms": True,
        },
    }
    # SMS 대체 발송용 텍스트 (알림톡 실패 시)
    if fallback_text:
        message["text"] = fallback_text

    body = {"message": message}
    logger.info("Alimtalk send - template: %s, variables: %s", template_id, variables)

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
