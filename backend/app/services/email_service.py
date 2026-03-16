"""Email notification service.

Sends emails via SMTP when configured. Falls back to mock logging when
SMTP_HOST is empty (e.g., in development / test environments).
"""
import logging
import smtplib
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

from app.core.config import settings

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Internal helper
# ---------------------------------------------------------------------------

def _send_smtp(to: str, subject: str, body_html: str) -> bool:
    """Send a single email via SMTP. Returns True on success."""
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = settings.SMTP_USER
    msg["To"] = to
    msg.attach(MIMEText(body_html, "html", "utf-8"))

    with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT) as server:
        server.ehlo()
        server.starttls()
        server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
        server.sendmail(settings.SMTP_USER, [to], msg.as_string())
    return True


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def send_portal_link_email(
    client_email: str,
    client_name: str,
    portal_link: str,
) -> bool:
    """Send portal view link to a client.

    Returns True when mail was actually dispatched, False when only mocked.
    Never raises; errors are logged.
    """
    try:
        if not settings.SMTP_HOST:
            logger.info(
                "[MOCK EMAIL] portal link → %s (%s): %s",
                client_email,
                client_name,
                portal_link,
            )
            return False

        subject = "[포트폴리오 조회] 내 포트폴리오를 확인해 보세요"
        body = f"""
        <html><body>
        <p>안녕하세요, <strong>{client_name}</strong>님.</p>
        <p>아래 링크를 통해 포트폴리오를 조회하실 수 있습니다.</p>
        <p><a href="{portal_link}">{portal_link}</a></p>
        <p>링크는 보안 상 담당자만 발급합니다.</p>
        </body></html>
        """
        return _send_smtp(client_email, subject, body)

    except Exception as exc:
        logger.error("Email send failed (portal link): %s", exc)
        return False


async def send_suggestion_email(
    client_email: str,
    client_name: str,
    suggestion_link: str,
    expires_at: Optional[datetime],
) -> bool:
    """Send rebalancing suggestion link to a client.

    Returns True when mail was actually dispatched, False when only mocked.
    Never raises; errors are logged.
    """
    try:
        expires_str = (
            expires_at.strftime("%Y년 %m월 %d일") if expires_at else "7일 후"
        )

        if not settings.SMTP_HOST:
            logger.info(
                "[MOCK EMAIL] suggestion link → %s (%s): %s (expires: %s)",
                client_email,
                client_name,
                suggestion_link,
                expires_str,
            )
            return False

        subject = "[포트폴리오 변경 안내] 담당자 리밸런싱 제안이 도착했습니다"
        body = f"""
        <html><body>
        <p>안녕하세요, <strong>{client_name}</strong>님.</p>
        <p>담당자가 리밸런싱 제안을 보냈습니다. 아래 링크에서 확인하세요.</p>
        <p><a href="{suggestion_link}">{suggestion_link}</a></p>
        <p><em>이 링크는 <strong>{expires_str}</strong>까지 유효합니다.</em></p>
        </body></html>
        """
        return _send_smtp(client_email, subject, body)

    except Exception as exc:
        logger.error("Email send failed (suggestion link): %s", exc)
        return False


async def notify_staff_call_reservation(
    reservation_id: str,
    client_name: str,
    preferred_date: str,
    preferred_time: str,
) -> bool:
    """Notify staff via email when a client makes a call reservation.

    Returns True when mail was actually dispatched, False when only mocked.
    Never raises; errors are logged.
    """
    try:
        if not settings.SMTP_HOST or not settings.STAFF_EMAIL:
            logger.info(
                "[MOCK EMAIL] call reservation alert → staff (%s): "
                "id=%s, client=%s, date=%s %s",
                settings.STAFF_EMAIL,
                reservation_id,
                client_name,
                preferred_date,
                preferred_time,
            )
            return False

        subject = f"[통화예약] {client_name}님이 통화를 예약했습니다"
        body = f"""
        <html><body>
        <p>새로운 통화 예약이 접수되었습니다.</p>
        <table border="1" cellpadding="5" cellspacing="0">
          <tr><th>예약 ID</th><td>{reservation_id}</td></tr>
          <tr><th>고객명</th><td>{client_name}</td></tr>
          <tr><th>희망 날짜</th><td>{preferred_date}</td></tr>
          <tr><th>희망 시간</th><td>{preferred_time}</td></tr>
        </table>
        </body></html>
        """
        return _send_smtp(settings.STAFF_EMAIL, subject, body)

    except Exception as exc:
        logger.error("Email send failed (staff call reservation alert): %s", exc)
        return False
