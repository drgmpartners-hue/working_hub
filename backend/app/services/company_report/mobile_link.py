"""로그인 없이 여는 폰 전용 브리핑 화면의 열쇠값.

승인된 v1 알림톡 버튼 주소는 그대로 쓴다.
  데일리: https://working-hub.vercel.app/content/company-report/briefing?date=#{날짜코드}
  월간:   https://working-hub.vercel.app/content/company-report/briefing?month=#{월코드}
변수 자리에 날짜 대신 '날짜.수신자.만료일.서명'을 넣는다(예: 2026-09-30.3f2a…-….20261114.Xk3p9QwLm2aZ7bYc).
프론트 proxy가 이 값을 보면 로그인 화면 대신 /m/daily·/m/monthly(폰 전용, 읽기 전용)로 보낸다.

- 서명: SECRET_KEY로 만든 HMAC-SHA256(추측·위조 불가)
- 수신자별 값: 수신자에서 빼거나 계정이 비활성화되면 더 이상 열리지 않는다
- 만료: 발송일부터 45일
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import re
from datetime import date, timedelta
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.services.company_report import config
from app.services.company_report.timeutil import today_kst

VALID_DAYS = 45
SIG_LEN = 16
_KEY_RE = {"d": re.compile(r"^\d{4}-\d{2}-\d{2}$"), "m": re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")}
_SUBJ_RE = re.compile(r"^u?[0-9a-f-]{36}$")


class LinkError(ValueError):
    pass


def _sig(kind: str, key: str, subject: str, exp: str, secret: Optional[str] = None) -> str:
    mac = hmac.new((secret or settings.SECRET_KEY).encode(), f"cr-mobile|{kind}|{key}|{subject}|{exp}".encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(mac).decode().rstrip("=")[:SIG_LEN]


def _sig_ok(sig: str, *parts: str) -> bool:
    """지금 SECRET_KEY 또는 예전 값(OLD_SECRET_KEYS)으로 만든 서명이면 통과 — 키를 바꿔도 이미 보낸 링크가 열린다."""
    return any(hmac.compare_digest(sig, _sig(*parts, secret=s)) for s in settings.link_secrets())


def subject_for(recipient_id: Optional[str], user_id: Optional[str]) -> str:
    """수신자 id(발송 설정에 등록된 사람) 또는 'u'+계정 id(본인 테스트 발송)."""
    if recipient_id:
        return recipient_id
    if user_id:
        return f"u{user_id}"
    raise LinkError("수신자 정보가 없습니다.")


def make(kind: str, key: str, subject: str, today: Optional[date] = None, days: int = VALID_DAYS) -> str:
    """kind: 'd'(데일리, key=YYYY-MM-DD) / 'm'(월간, key=YYYY-MM)"""
    if kind not in _KEY_RE or not _KEY_RE[kind].match(key) or not _SUBJ_RE.match(subject):
        raise LinkError("잘못된 값")
    exp = ((today or today_kst()) + timedelta(days=days)).strftime("%Y%m%d")
    return f"{key}.{subject}.{exp}.{_sig(kind, key, subject, exp)}"


def parse(kind: str, token: str, today: Optional[date] = None) -> tuple[str, str]:
    """(key, subject). 형식·서명·만료가 틀리면 LinkError."""
    parts = (token or "").strip().split(".")
    if len(parts) != 4:
        raise LinkError("링크 형식이 올바르지 않습니다.")
    key, subject, exp, sig = parts
    if kind not in _KEY_RE or not _KEY_RE[kind].match(key) or not _SUBJ_RE.match(subject) or not re.match(r"^\d{8}$", exp):
        raise LinkError("링크 형식이 올바르지 않습니다.")
    if not _sig_ok(sig, kind, key, subject, exp):
        raise LinkError("링크가 올바르지 않습니다.")
    if (today or today_kst()).strftime("%Y%m%d") > exp:
        raise LinkError("링크 사용 기간(45일)이 지났습니다. Working Hub에 로그인해서 확인해 주세요.")
    return key, subject


async def subject_active(db: AsyncSession, subject: str) -> bool:
    """지금도 받을 자격이 있는지(수신자 해제·계정 비활성화면 False)."""
    from app.models.news_briefing import BriefingRecipient
    from app.models.user import User

    if subject.startswith("u"):
        u = await db.get(User, subject[1:])
        return bool(u and u.is_active)
    r = await db.get(BriefingRecipient, subject)
    return bool(r and r.is_active)


async def subject_company_ids(db: AsyncSession, subject: str) -> Optional[set[str]]:
    """링크를 받은 사람에게 보여 줄 기업(docs/login_logic P9). None = 거르지 않음.

    - 수신자: 그 수신자가 속한 명단의 주인 기준(매니저 명단 → 그 매니저 화면, 회사 명단 → 회사 공통)
    - 본인 테스트('u'+계정): 매니저면 자기 화면, 대표면 전체
    """
    from app.core.permissions import is_owner
    from app.models.news_briefing import BriefingRecipient
    from app.models.user import User
    from app.services.company_report import visibility as vis

    if subject.startswith("u"):
        u = await db.get(User, subject[1:])
        if not u or is_owner(u):
            return None
        return await vis.visible_company_ids(db, vis.manager_view(u, u.id))
    r = await db.get(BriefingRecipient, subject)
    return await vis.visible_company_ids(db, await vis.list_view(db, r.manager_user_id if r else None))


def page_url(kind: str, token: str) -> str:
    """문자(LMS)로 나갈 때 본문에 넣는 폰 화면 주소."""
    return f"{config.WEB_BASE}/m/{'daily' if kind == 'd' else 'monthly'}?t={token}"
