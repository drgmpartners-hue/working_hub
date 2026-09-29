"""브리핑 발송(기획 11장 템플릿 B, 12장 데일리 6).

- 08:30 배치: 오늘 브리핑이 approved면 수신자(2~5명)에게 알림톡(템플릿 B), 실패 시 LMS 대체
- 승인 기간인데 draft면 보내지 않고 held로 남긴다(관리자가 승인하면 다음 send 실행 때 발송)
- 같은 날 중복 발송 차단(status=sent), 수신자별 발송 기록(briefing_send_logs)
- 템플릿 B ID가 아직 없으면(심사 전) 같은 내용을 LMS로 보낸다
"""
from __future__ import annotations

import logging
from datetime import date
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.news_briefing import BriefingRecipient, BriefingSendLog, NewsBriefing
from app.models.user import User
from app.services import settings_store, solapi_service
from app.services.company_report import config
from app.services.company_report.timeutil import now_kst, today_kst

logger = logging.getLogger(__name__)

# 알림톡 본문은 변수를 채운 뒤 1,000자 이내여야 한다(고정 문구 약 210자 + 변수 상한 합계 ≈ 970자)
LIMIT_OVERALL = 230
LIMIT_COMPANIES = 330
LIMIT_WEATHER = 60
LIMIT_MARKETS = 130
TOP_COMPANIES = 5


def _cut(text: str, n: int) -> str:
    text = (text or "").strip()
    return text if len(text) <= n else text[: n - 1].rstrip() + "…"


def _fmt_num(v) -> str:
    return f"{v:,.1f}" if isinstance(v, (int, float)) else "-"


def market_lines(markets: list[dict]) -> str:
    """#{전일증시} 두 줄: 종가(등락률)만."""
    def part(m: dict) -> str:
        if not m.get("available"):
            return f"{m['name']} 조회실패"
        pct = m.get("change_pct")
        sign = "+" if (pct or 0) > 0 else ""
        return f"{m['name']} {_fmt_num(m.get('close'))}({sign}{pct:.1f}%)" if pct is not None else f"{m['name']} {_fmt_num(m.get('close'))}"

    us = " ".join(part(m) for m in markets if m.get("market") == "US")
    kr = " ".join(part(m) for m in markets if m.get("market") == "KR")
    return "\n".join(x for x in (f"미 {us}" if us else "", f"한 {kr}" if kr else "") if x)


def template_b_variables(b: NewsBriefing, name: str = "") -> dict[str, str]:
    info = b.basic_info or {}
    w = info.get("weather") or {}
    overall = [x.get("text", "") for x in ((b.review_summary or {}).get("overall") or [])] or (b.overall_summary or "").split("\n")
    overall_txt = _cut("\n".join(f"- {t}" for t in overall if t.strip()), LIMIT_OVERALL)
    comp_lines = []
    for c in (b.company_summaries or [])[:TOP_COMPANIES]:
        flag = " [주의]" if c.get("caution_count") else ""
        comp_lines.append(f"· {c['name']}{flag}: {c.get('one_liner') or ''}")
    more = len(b.company_summaries or []) - TOP_COMPANIES
    if more > 0:
        comp_lines.append(f"외 {more}개 기업")
    comps_txt = _cut("\n".join(comp_lines) or "새 기사가 없습니다.", LIMIT_COMPANIES)
    d = b.briefing_date
    return {
        "#{담당자명}": (name or "").strip() or "사내",
        "#{날짜}": f"{d.month}/{d.day}({info.get('weekday', '')})",
        "#{날씨}": _cut(f"{w.get('region') or '서울'} {w.get('text') or ''}", LIMIT_WEATHER)
        if w.get("available") else f"{w.get('region') or '서울'} 날씨 조회 실패",
        "#{전일증시}": _cut(market_lines(info.get("markets") or []), LIMIT_MARKETS) or "조회 실패",
        "#{기업수}": str(info.get("company_with_news", 0)),
        "#{기사수}": str(b.article_count or 0),
        "#{주의수}": str(b.caution_count or 0),
        "#{종합브리핑}": overall_txt or "-",
        "#{기업별요약}": comps_txt,
        "#{날짜코드}": d.isoformat(),
    }


def briefing_url(d: date) -> str:
    return f"{config.WEB_BASE}/content/company-report/briefing?date={d.isoformat()}"


INTRO = "본 메시지는 사내 업무 시스템(Working Hub)에 투자기업 브리핑 수신자로 등록된 임직원께 평일 오전 발송되는 업무 알림입니다."


def render_text(b: NewsBriefing, name: str = "") -> str:
    """템플릿 B와 같은 내용의 LMS 본문(알림톡 실패·템플릿 심사 전)."""
    v = template_b_variables(b, name)
    return (
        "[사내 업무용 메시지]\n"
        f"{v['#{담당자명}']} 담당자님, 오늘의 투자기업 데일리 브리핑이 준비되었습니다.\n\n"
        f"{INTRO}\n\n"
        f"■ 기본정보\n{v['#{날짜}']} | {v['#{날씨}']}\n{v['#{전일증시}']}\n"
        f"대상 {v['#{기업수}']}개 기업 · 기사 {v['#{기사수}']}건 · 주의 {v['#{주의수}']}건\n\n"
        f"■ 종합브리핑\n{v['#{종합브리핑}']}\n\n"
        f"■ 기업별 브리핑\n{v['#{기업별요약}']}\n\n"
        f"브리핑 보기: {briefing_url(b.briefing_date)}"
    )


class Target:
    """발송 대상 한 명(직원 계정 또는 고객 정보)."""

    def __init__(self, recipient_id: Optional[str], name: str, phone: Optional[str], user_id: Optional[str] = None,
                 client_id: Optional[str] = None, kind: str = "user"):
        self.recipient_id, self.name, self.phone = recipient_id, name, phone
        self.user_id, self.client_id, self.kind = user_id, client_id, kind


async def recipient_targets(db: AsyncSession, include_no_phone: bool = False) -> list[Target]:
    """활성 수신자 → 지금 원본(계정·고객 정보)의 휴대폰 번호로."""
    from app.models.client import Client

    rows = (await db.execute(
        select(BriefingRecipient, User, Client)
        .outerjoin(User, User.id == BriefingRecipient.user_id)
        .outerjoin(Client, Client.id == BriefingRecipient.client_id)
        .where(BriefingRecipient.is_active == True)  # noqa: E712
        .order_by(BriefingRecipient.created_at)
    )).all()
    out: list[Target] = []
    for r, u, c in rows:
        if u is not None:
            if not u.is_active:
                continue
            t = Target(r.id, u.nickname, u.phone, user_id=u.id, kind="user")
        elif c is not None:
            t = Target(r.id, c.name, c.phone, client_id=c.id, kind="client")
        else:
            continue
        if t.phone or include_no_phone:
            out.append(t)
    return out


async def recipients(db: AsyncSession) -> list[Target]:
    return await recipient_targets(db)


async def _deliver(db: AsyncSession, b: NewsBriefing, targets: list, briefing_type: str) -> dict:
    template_id = await settings_store.get(db, config.TEMPLATE_DAILY)
    # 수신자마다 #{담당자명}이 달라서 본문·변수를 한 명씩 만든다
    msgs = [{
        "to": t.phone, "text": render_text(b, t.name), "subject": "[사내] 투자기업 데일리 브리핑",
        **({"template_id": template_id, "variables": template_b_variables(b, t.name)} if template_id else {}),
    } for t in targets]
    res = await solapi_service.send_many_alimtalk(db, msgs)
    ok = bool(res.get("success"))
    channel = "alimtalk" if template_id else "lms"
    for t in targets:
        db.add(BriefingSendLog(
            briefing_type=briefing_type, briefing_id=b.id, user_id=getattr(t, "user_id", None) or getattr(t, "id", None),
            phone=t.phone, channel=channel,
            status="requested" if ok else "failed", solapi_group_id=res.get("groupId") or (res.get("groupInfo") or {}).get("groupId"),
            error=None if ok else str(res.get("error") or res.get("errorMessage") or res)[:1000],
        ))
    return {"success": ok, "channel": channel, "count": len(targets), "error": None if ok else res.get("error") or res.get("errorMessage")}


async def send_daily(db: AsyncSession, day: Optional[date] = None) -> dict:
    """08:30 배치. 조건이 맞을 때만 보낸다."""
    day = day or today_kst()
    if not await settings_store.get_bool(db, config.BRIEFING_ENABLED, default=False):
        return {"skipped": "발송 꺼짐(발송 설정에서 켜기)"}
    b = (await db.execute(select(NewsBriefing).where(NewsBriefing.briefing_date == day))).scalar_one_or_none()
    if not b:
        return {"skipped": "오늘 브리핑 없음"}
    if b.status == "sent":
        return {"skipped": "이미 발송됨"}
    if b.status not in ("approved", "failed"):  # failed는 재시도 허용
        return {"held": f"승인 대기({b.status}) — 관리자 승인 후 발송"}
    users = await recipients(db)
    if not users:
        return {"skipped": "수신자 없음(휴대폰 번호가 있는 수신자를 지정하세요)"}
    r = await _deliver(db, b, users, "daily")
    if r["success"]:
        b.status, b.sent_at = "sent", now_kst()
        # 브리핑 PDF는 Volume이 붙은 웹 서비스의 file_worker가 '_포트폴리오 공통'에 저장한다
    else:
        b.status = "failed"
    await settings_store.set_value(db, config.LAST_SEND_AT, now_kst().isoformat(timespec="seconds"))
    await db.commit()
    return r


async def send_test(db: AsyncSession, briefing_id: str, user: User, recipient_id: Optional[str] = None) -> dict:
    """테스트 발송: 지정한 수신자 한 명(없으면 요청한 본인). 브리핑 상태는 바꾸지 않는다."""
    b = await db.get(NewsBriefing, briefing_id)
    if not b:
        return {"success": False, "error": "브리핑이 없습니다."}
    if recipient_id:
        t = next((x for x in await recipient_targets(db, include_no_phone=True) if x.recipient_id == recipient_id), None)
        if not t:
            return {"success": False, "error": "수신자를 찾을 수 없습니다."}
        if not t.phone:
            return {"success": False, "error": f"{t.name}님의 휴대폰 번호가 없습니다."}
        target = t
    else:
        if not user.phone:
            return {"success": False, "error": "내 계정에 휴대폰 번호가 없습니다. 발송 설정의 수신자 옆 [테스트]로 보내 보세요."}
        target = Target(None, user.nickname, user.phone, user_id=user.id)
    r = await _deliver(db, b, [target], "test")
    await db.commit()
    return {**r, "to": target.name}
