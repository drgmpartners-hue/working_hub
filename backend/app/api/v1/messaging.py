"""Messaging API — SMS 발송 (Solapi)."""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.session import get_db
from app.core.deps import get_current_user
from app.models.client import Client
from app.services import solapi_service

router = APIRouter(prefix="/messaging", tags=["messaging"])


class SendSmsRequest(BaseModel):
    """단건 SMS 발송."""
    client_id: str
    message: str


class SendSmsToPhoneRequest(BaseModel):
    """전화번호 직접 지정 SMS 발송."""
    to: str
    message: str


class SendLinkRequest(BaseModel):
    """포털 링크 SMS 발송."""
    client_id: str
    link_type: str = "portal"  # "portal" or "suggestion"
    suggestion_id: Optional[str] = None


class BulkSendRequest(BaseModel):
    """다건 SMS 발송."""
    client_ids: list[str]
    message: str


@router.post("/send-sms")
async def send_sms(
    body: SendSmsRequest,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """고객에게 SMS 발송."""
    client = await _get_client(db, current_user.id, body.client_id)
    if not client.phone:
        raise HTTPException(400, f"'{client.name}' 고객의 전화번호가 없습니다.")

    result = await solapi_service.send_sms(db=db, to=client.phone, text=body.message)

    if not result.get("success"):
        raise HTTPException(500, f"발송 실패: {result.get('error', '알 수 없는 오류')}")

    return {"success": True, "client_name": client.name}


@router.post("/send-link")
async def send_portal_link(
    body: SendLinkRequest,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """고객에게 포털 링크를 SMS로 발송."""
    from app.core.config import settings

    client = await _get_client(db, current_user.id, body.client_id)
    if not client.phone:
        raise HTTPException(400, f"'{client.name}' 고객의 전화번호가 없습니다.")
    if not client.portal_token:
        raise HTTPException(400, f"'{client.name}' 고객의 포털 토큰이 없습니다.")

    base_url = settings.FRONTEND_URL
    if body.link_type == "suggestion" and body.suggestion_id:
        link = f"{base_url}/client/{client.portal_token}?suggest={body.suggestion_id}"
        msg = (
            f"[Working Hub] {client.name}({client.unique_code or ''})님,\n"
            f"포트폴리오 변경 제안이 도착했습니다.\n"
            f"아래 링크에서 확인해주세요.\n{link}"
        )
    else:
        link = f"{base_url}/client/{client.portal_token}"
        msg = (
            f"[Working Hub] {client.name}({client.unique_code or ''})님,\n"
            f"포트폴리오 현황을 확인하세요.\n{link}"
        )

    result = await solapi_service.send_sms(db=db, to=client.phone, text=msg)

    if not result.get("success"):
        raise HTTPException(500, f"발송 실패: {result.get('error', '알 수 없는 오류')}")

    return {"success": True, "client_name": client.name, "link": link}


@router.post("/send-bulk-sms")
async def send_bulk_sms(
    body: BulkSendRequest,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """여러 고객에게 SMS 발송."""
    result = await db.execute(
        select(Client).where(
            Client.id.in_(body.client_ids),
            Client.user_id == current_user.id,
        )
    )
    clients = result.scalars().all()
    if not clients:
        raise HTTPException(404, "고객을 찾을 수 없습니다.")

    recipients = []
    skipped = []
    for c in clients:
        if not c.phone:
            skipped.append(f"{c.name}({c.unique_code or ''})")
            continue
        recipients.append({"to": c.phone, "text": body.message})

    if not recipients:
        raise HTTPException(400, f"전화번호가 없는 고객: {', '.join(skipped)}")

    send_result = await solapi_service.send_bulk_sms(db=db, recipients=recipients)

    if not send_result.get("success"):
        raise HTTPException(500, f"발송 실패: {send_result.get('error')}")

    return {
        "success": True,
        "sent_count": len(recipients),
        "skipped": skipped,
    }


# --- 카카오 알림톡 ---

class SendAlimtalkRequest(BaseModel):
    """카카오 알림톡 발송."""
    client_id: str
    template_id: str
    variables: dict[str, str]  # e.g. {"#{고객명}": "홍길동", "#{링크}": "https://..."}
    fallback_text: str = ""    # SMS 대체 발송 텍스트


@router.get("/kakao-templates")
async def get_kakao_templates(
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """검수 통과된 카카오 알림톡 템플릿 목록 조회."""
    result = await solapi_service.get_kakao_templates(db)
    if "error" in result:
        raise HTTPException(400, result["error"])
    return result


@router.post("/send-alimtalk")
async def send_alimtalk(
    body: SendAlimtalkRequest,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """고객에게 카카오 알림톡 발송."""
    client = await _get_client(db, current_user.id, body.client_id)
    if not client.phone:
        raise HTTPException(400, f"'{client.name}' 고객의 전화번호가 없습니다.")

    result = await solapi_service.send_alimtalk(
        db=db,
        to=client.phone,
        template_id=body.template_id,
        variables=body.variables,
        fallback_text=body.fallback_text,
    )

    if not result.get("success"):
        raise HTTPException(500, f"알림톡 발송 실패: {result.get('error', '알 수 없는 오류')}")

    return {"success": True, "client_name": client.name}


@router.get("/balance")
async def check_balance(
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """솔라피 잔액 조회."""
    result = await solapi_service.get_balance(db)
    return result


async def _get_client(db: AsyncSession, user_id: str, client_id: str) -> Client:
    result = await db.execute(
        select(Client).where(Client.id == client_id, Client.user_id == user_id)
    )
    client = result.scalar_one_or_none()
    if not client:
        raise HTTPException(404, "고객을 찾을 수 없습니다.")
    return client
