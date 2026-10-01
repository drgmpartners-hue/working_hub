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

LIMIT_WEATHER = 60
LIMIT_MARKETS = 240


def _cut(text: str, n: int) -> str:
    text = (text or "").strip()
    return text if len(text) <= n else text[: n - 1].rstrip() + "…"


def _fmt_num(v) -> str:
    return f"{v:,.1f}" if isinstance(v, (int, float)) else "-"


def market_lines(markets: list[dict]) -> str:
    """#{전일증시}: 한 줄에 하나씩 '이름 종가(등락률)'. 금은 $, 환율은 원을 붙인다."""
    def part(m: dict) -> str:
        if not m.get("available"):
            return f"{m['name']} 조회 실패"
        unit = m.get("unit") or ""
        close = _fmt_num(m.get("close"))
        val = f"${close}" if unit == "$" else f"{close}{unit}"
        pct = m.get("change_pct")
        if pct is None:
            return f"{m['name']} {val}"
        sign = "+" if pct > 0 else ""
        return f"{m['name']} {val}({sign}{pct:.1f}%)"

    return "\n".join(part(m) for m in markets if m.get("name"))


# --------------------------------------------------------------------------- 데일리(승인된 템플릿 B v1)
# 카톡 본문은 요약만. [브리핑 보기] 버튼 → 로그인 없는 폰 전용 화면(/m/daily)에서 문장별 [1][2]를 누르면 원문 기사.
# 버튼 주소의 #{날짜코드} 자리에 날짜 대신 수신자별 열쇠값(mobile_link)을 넣는다.
# 알림톡은 변수를 채운 뒤 1,000자, 문자(LMS) 대체 발송은 2,000바이트 이내여야 해서 줄 수를 자동으로 줄인다.

TEMPLATE_B = """[사내 업무용 메시지]
#{담당자명} 담당자님, 오늘의 투자기업 데일리 브리핑이 준비되었습니다.

본 메시지는 사내 업무 시스템(Working Hub)에 투자기업 브리핑 수신자로 등록된 임직원께 평일 오전 발송되는 업무 알림입니다.

■ 기본정보
#{날짜} | #{날씨}
#{전일증시}
대상 #{기업수}개 기업 · 기사 #{기사수}건 · 주의 #{주의수}건

■ 종합브리핑
#{종합브리핑}

■ 기업별 브리핑
#{기업별요약}

전체 기사와 원문 링크는 아래 버튼에서 확인해 주세요."""

LMS_TAIL = "전체 기사와 원문 링크는 아래 주소에서 확인해 주세요(로그인 없이 열림).\n"
MAX_CHARS = 990      # 알림톡 1,000자
MAX_BYTES = 1990     # LMS 2,000바이트(EUC-KR 기준 한글 2바이트)
LINE_CUT = 60        # 기업별 한 줄 길이


def fill(template: str, v: dict[str, str]) -> str:
    out = template
    for k, val in v.items():
        out = out.replace(k, val)
    return out


def _fits(text: str) -> bool:
    return len(text) <= MAX_CHARS and len(text.encode("euc-kr", errors="replace")) <= MAX_BYTES


def to_lms(alimtalk_text: str, button_tail: str, page_url: str) -> str:
    """알림톡 본문의 '아래 버튼…' 줄을 폰 화면 주소로 바꾼 문자(LMS) 본문."""
    body = alimtalk_text[: -len(button_tail)] if alimtalk_text.endswith(button_tail) else alimtalk_text
    return body + LMS_TAIL + page_url


def _daily_parts(b: NewsBriefing) -> tuple[list[dict], list[dict]]:
    """(종합 문장[{text, article_ids}], 기업 카드). 종합 문장의 출처 id(A1…)를 기사 id로 바꾼다."""
    cards = b.company_summaries or []
    rs = b.review_summary or {}
    smap = rs.get("source_map")
    if not smap and cards and all(isinstance(c.get("articles"), list) for c in cards):
        from app.services.company_report.daily import build_sources  # 예전 브리핑: 같은 규칙으로 다시 계산

        smap = build_sources(cards)[1]
    smap = smap or {}
    overall = rs.get("overall") or [{"text": t, "source_ids": []} for t in (b.overall_summary or "").split("\n") if t.strip()]
    lines = [{"text": (s.get("text") or "").strip(), "article_ids": [smap[x] for x in s.get("source_ids") or [] if x in smap]}
             for s in overall if (s.get("text") or "").strip()]
    return lines, cards


DAILY_BUTTON_TAIL = "전체 기사와 원문 링크는 아래 버튼에서 확인해 주세요."


def template_b_variables(b: NewsBriefing, name: str = "", token: Optional[str] = None,
                         extra_len: int = 0) -> dict[str, str]:
    """token: 버튼 주소의 #{날짜코드}에 넣을 열쇠값(없으면 날짜). extra_len: 문자 발송 때 늘어나는 글자 수."""
    info = b.basic_info or {}
    w = info.get("weather") or {}
    lines, cards = _daily_parts(b)
    d = b.briefing_date
    base = {
        "#{담당자명}": (name or "").strip() or "사내",
        "#{날짜}": f"{d.month}/{d.day}({info.get('weekday', '')})",
        "#{날씨}": _cut(f"{w.get('region') or '서울'} {w.get('text') or ''}", LIMIT_WEATHER)
        if w.get("available") else f"{w.get('region') or '서울'} 날씨 조회 실패",
        "#{전일증시}": _cut(market_lines(info.get("markets") or []), LIMIT_MARKETS) or "조회 실패",
        "#{기업수}": str(info.get("company_with_news", 0)),
        "#{기사수}": str(b.article_count or 0),
        "#{주의수}": str(b.caution_count or 0),
        "#{날짜코드}": token or d.isoformat(),
    }

    def build(n_over: int, n_comp: int, cut_over: int) -> dict[str, str]:
        over = [f"- {_cut(ln['text'], cut_over)}" for ln in lines[:n_over]]
        comp = [f"· {c['name']}{' [주의]' if c.get('caution_count') else ''}: {_cut(c.get('one_liner') or '', LINE_CUT)}"
                for c in cards[:n_comp]]
        if len(cards) > n_comp:
            comp.append(f"외 {len(cards) - n_comp}개 기업")
        return {**base, "#{종합브리핑}": "\n".join(over) or "-", "#{기업별요약}": "\n".join(comp) or "새 기사가 없습니다."}

    def fits(v):
        return _fits(fill(TEMPLATE_B, v) + "x" * extra_len)

    n_over, n_comp, cut_over = min(len(lines), 5), min(len(cards), 8), 120
    v = build(n_over, n_comp, cut_over)
    while not fits(v):
        if n_comp > 4:
            n_comp -= 1
        elif cut_over > 70:
            cut_over -= 10
        elif n_over > 3:
            n_over -= 1
        elif n_comp > 1:
            n_comp -= 1
        elif n_over > 1:
            n_over -= 1
        else:
            break
        v = build(n_over, n_comp, cut_over)
    return v


def briefing_url(d: date) -> str:
    return f"{config.WEB_BASE}/content/company-report/briefing?date={d.isoformat()}"


INTRO = "본 메시지는 사내 업무 시스템(Working Hub)에 투자기업 브리핑 수신자로 등록된 임직원께 평일 오전 발송되는 업무 알림입니다."


def render_text(b: NewsBriefing, name: str = "", token: Optional[str] = None) -> str:
    """알림톡(템플릿 B v1)과 같은 본문. token이 있으면 문자(LMS)용: 버튼 문구 대신 폰 화면 주소."""
    from app.services.company_report import mobile_link

    if not token:
        return fill(TEMPLATE_B, template_b_variables(b, name))
    url = mobile_link.page_url("d", token)
    extra = len(LMS_TAIL) + len(url) - len(DAILY_BUTTON_TAIL)
    return to_lms(fill(TEMPLATE_B, template_b_variables(b, name, token, extra_len=max(0, extra))), DAILY_BUTTON_TAIL, url)


def daily_token(b: NewsBriefing, t) -> str:
    from app.services.company_report import mobile_link

    return mobile_link.make("d", b.briefing_date.isoformat(),
                            mobile_link.subject_for(getattr(t, "recipient_id", None), getattr(t, "user_id", None)))


class Target:
    """발송 대상 한 명(직원 계정 또는 고객 정보). list_owner: 속한 명단의 주인(None = 회사 명단)."""

    def __init__(self, recipient_id: Optional[str], name: str, phone: Optional[str], user_id: Optional[str] = None,
                 client_id: Optional[str] = None, kind: str = "user", list_owner: Optional[str] = None):
        self.recipient_id, self.name, self.phone = recipient_id, name, phone
        self.user_id, self.client_id, self.kind = user_id, client_id, kind
        self.list_owner = list_owner


_ALL_LISTS = object()


async def recipient_targets(db: AsyncSession, include_no_phone: bool = False, list_owner=_ALL_LISTS) -> list[Target]:
    """활성 수신자 → 지금 원본(계정·고객 정보)의 휴대폰 번호로.
    list_owner: 생략하면 모든 명단(발송 배치), None 이면 회사 명단, 매니저 id 면 그 매니저 명단."""
    from app.models.client import Client

    stmt = (
        select(BriefingRecipient, User, Client)
        .outerjoin(User, User.id == BriefingRecipient.user_id)
        .outerjoin(Client, Client.id == BriefingRecipient.client_id)
        .where(BriefingRecipient.is_active == True)  # noqa: E712
        .order_by(BriefingRecipient.created_at)
    )
    if list_owner is not _ALL_LISTS:
        stmt = stmt.where(BriefingRecipient.manager_user_id == list_owner if list_owner
                          else BriefingRecipient.manager_user_id.is_(None))
    rows = (await db.execute(stmt)).all()
    out: list[Target] = []
    for r, u, c in rows:
        if u is not None:
            if not u.is_active:
                continue
            t = Target(r.id, u.nickname, u.phone, user_id=u.id, kind="user", list_owner=r.manager_user_id)
        elif c is not None:
            t = Target(r.id, c.name, c.phone, client_id=c.id, kind="client", list_owner=r.manager_user_id)
        else:
            continue
        if t.phone or include_no_phone:
            out.append(t)
    return out


async def recipients(db: AsyncSession) -> list[Target]:
    return await recipient_targets(db)


async def _deliver_generic(db: AsyncSession, briefing_id: str, targets: list, briefing_type: str, template_key: str,
                           subject: str, template_text: str, lms_fn, vars_fn) -> dict:
    """템플릿 ID가 있으면 알림톡(본문 = 승인된 템플릿에 변수를 채운 것, 실패 시 같은 내용 문자로 대체),
    없으면 문자(LMS) — 문자는 버튼이 없으니 본문 끝에 폰 화면 주소를 넣는다."""
    template_id = await settings_store.get(db, template_key)
    msgs = []
    for t in targets:  # 수신자마다 이름·열쇠값(폰 화면 링크)이 다르다
        if template_id:
            v = vars_fn(t)
            msgs.append({"to": t.phone, "text": fill(template_text, v), "subject": subject, "template_id": template_id, "variables": v})
        else:
            msgs.append({"to": t.phone, "text": lms_fn(t), "subject": subject})
    res = await solapi_service.send_many_alimtalk(db, msgs)
    ok = bool(res.get("success"))
    channel = "alimtalk" if template_id else "lms"
    for t in targets:
        db.add(BriefingSendLog(
            briefing_type=briefing_type, briefing_id=briefing_id, user_id=getattr(t, "user_id", None) or getattr(t, "id", None),
            phone=t.phone, recipient_name=(getattr(t, "name", None) or None), channel=channel,
            status="requested" if ok else "failed", solapi_group_id=res.get("groupId") or (res.get("groupInfo") or {}).get("groupId"),
            error=None if ok else str(res.get("error") or res.get("errorMessage") or res)[:1000],
        ))
    return {"success": ok, "channel": channel, "count": len(targets), "error": None if ok else res.get("error") or res.get("errorMessage")}


async def _target_ids(db: AsyncSession, t) -> Optional[set[str]]:
    """받는 사람에게 보여 줄 기업(docs/login_logic P9). 명단 주인 기준. 본인 테스트면 그 사람 기준."""
    from app.services.company_report import visibility as vis

    if getattr(t, "view", None) is not None:
        return await vis.visible_company_ids(db, t.view)
    return await vis.visible_company_ids(db, await vis.list_view(db, getattr(t, "list_owner", None)))


async def _views_for(db: AsyncSession, obj, targets: list, filt) -> dict[int, object]:
    cache: dict = {}
    out: dict[int, object] = {}
    for t in targets:
        key = ("v", id(t.view)) if getattr(t, "view", None) is not None else ("l", getattr(t, "list_owner", None))
        if key not in cache:
            cache[key] = filt(obj, await _target_ids(db, t))
        out[id(t)] = cache[key]
    return out


async def _deliver(db: AsyncSession, b: NewsBriefing, targets: list, briefing_type: str) -> dict:
    from app.services.company_report.visibility import filter_daily

    views = await _views_for(db, b, targets, filter_daily)
    return await _deliver_generic(
        db, b.id, targets, briefing_type, config.TEMPLATE_DAILY, "[사내] 투자기업 데일리 브리핑", TEMPLATE_B,
        lambda t: render_text(views[id(t)], t.name, daily_token(b, t)),
        lambda t: template_b_variables(views[id(t)], t.name, daily_token(b, t)),
    )


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


async def _self_target(user: User, view=None) -> Target:
    t = Target(None, user.nickname, user.phone, user_id=user.id)
    t.view = view  # 본인 테스트: 지금 보고 있는 담당자 화면 그대로
    return t


def _list_of(view) -> object:
    return _ALL_LISTS if view is None else view.list_owner


async def send_test(db: AsyncSession, briefing_id: str, user: User, recipient_id: Optional[str] = None, view=None) -> dict:
    """테스트 발송: 지정한 수신자 한 명(없으면 요청한 본인). 브리핑 상태는 바꾸지 않는다.
    view: 보고 있는 담당자 화면 — 수신자는 그 명단 안에서만 고를 수 있다."""
    b = await db.get(NewsBriefing, briefing_id)
    if not b:
        return {"success": False, "error": "브리핑이 없습니다."}
    if recipient_id:
        t = next((x for x in await recipient_targets(db, include_no_phone=True, list_owner=_list_of(view))
                  if x.recipient_id == recipient_id), None)
        if not t:
            return {"success": False, "error": "수신자를 찾을 수 없습니다."}
        if not t.phone:
            return {"success": False, "error": f"{t.name}님의 휴대폰 번호가 없습니다."}
        target = t
    else:
        if not user.phone:
            return {"success": False, "error": "내 계정에 휴대폰 번호가 없습니다. 오른쪽 위 이름 > 내 정보에서 휴대폰 번호를 저장해 주세요."}
        target = await _self_target(user, view)
    r = await _deliver(db, b, [target], "test")
    await db.commit()
    return {**r, "to": target.name}


# --------------------------------------------------------------------------- 월간(템플릿 C)

MONTHLY_INTRO = "본 메시지는 사내 업무 시스템(Working Hub)에 투자기업 브리핑 수신자로 등록된 임직원께 매월 초 발송되는 업무 알림입니다."

TEMPLATE_C = """[사내 업무용 메시지]
#{담당자명} 담당자님, #{월} 투자기업 월간 브리핑이 준비되었습니다.

본 메시지는 사내 업무 시스템(Working Hub)에 투자기업 브리핑 수신자로 등록된 임직원께 매월 초 발송되는 업무 알림입니다.

■ #{월} 요약
#{월간요약}

■ 주목할 기업
#{주목기업}

■ 주의가 필요한 기업
#{주의기업}

■ 다음 달 체크포인트
#{체크포인트}

기업별 정리와 고객 상담 참고 사항은 아래 버튼에서 확인해 주세요."""
MONTHLY_BUTTON_TAIL = "기업별 정리와 고객 상담 참고 사항은 아래 버튼에서 확인해 주세요."


def monthly_url(month: str) -> str:
    return f"{config.WEB_BASE}/content/company-report/briefing?month={month}"


def template_c_variables(mb, name: str = "", token: Optional[str] = None, extra_len: int = 0) -> dict[str, str]:
    c = mb.content or {}
    m = mb.month
    st = mb.stats or {}
    base = {"#{담당자명}": (name or "").strip() or "사내", "#{월}": f"{int(m[5:7])}월", "#{월코드}": token or m}

    def when_txt(x):
        w = x.get("when") or ""
        return f"{int(w[5:7])}월 " if len(w) == 7 and w[4] == "-" else ""

    def build(n: int, cut: int) -> dict[str, str]:
        summ = [f"- {_cut(x['text'], cut)}" for x in (c.get("summary") or [])[:n + 1]]
        hi = [f"· {x.get('name') or ''}: {_cut(x['text'], cut)}" for x in (c.get("highlights") or [])[:n]]
        cau = [f"· {x['name']}: {_cut((x.get('what') or {}).get('text', ''), cut)}" for x in (c.get("cautions") or [])[:n]]
        cps = [f"· {when_txt(x)}{x['name']}: {_cut(x['text'], cut)}" for x in (c.get("checkpoints") or [])[:n]]
        return {**base,
                "#{월간요약}": "\n".join(summ) or f"- 기사 {st.get('article_count', 0)}건, 주의 {st.get('caution_count', 0)}건",
                "#{주목기업}": "\n".join(hi) or "없음",
                "#{주의기업}": "\n".join(cau) or "없음",
                "#{체크포인트}": "\n".join(cps) or "없음"}

    n, cut = 5, 100
    v = build(n, cut)
    while not _fits(fill(TEMPLATE_C, v) + "x" * extra_len):
        if cut > 60:
            cut -= 10
        elif n > 1:
            n -= 1
        else:
            break
        v = build(n, cut)
    return v


def render_monthly_text(mb, name: str = "", token: Optional[str] = None) -> str:
    from app.services.company_report import mobile_link

    if not token:
        return fill(TEMPLATE_C, template_c_variables(mb, name))
    url = mobile_link.page_url("m", token)
    extra = len(LMS_TAIL) + len(url) - len(MONTHLY_BUTTON_TAIL)
    return to_lms(fill(TEMPLATE_C, template_c_variables(mb, name, token, extra_len=max(0, extra))), MONTHLY_BUTTON_TAIL, url)


def monthly_token(mb, t) -> str:
    from app.services.company_report import mobile_link

    return mobile_link.make("m", mb.month, mobile_link.subject_for(getattr(t, "recipient_id", None), getattr(t, "user_id", None)))


async def _deliver_monthly(db: AsyncSession, mb, targets: list, briefing_type: str) -> dict:
    from app.services.company_report.visibility import filter_monthly

    views = await _views_for(db, mb, targets, filter_monthly)
    return await _deliver_generic(
        db, mb.id, targets, briefing_type, config.TEMPLATE_MONTHLY, "[사내] 투자기업 월간 브리핑", TEMPLATE_C,
        lambda t: render_monthly_text(views[id(t)], t.name, monthly_token(mb, t)),
        lambda t: template_c_variables(views[id(t)], t.name, monthly_token(mb, t)),
    )


async def send_monthly(db: AsyncSession, day: Optional[date] = None, *, ignore_day: bool = False) -> dict:
    """08:30 배치(데일리와 같은 시각). 지난 달 월간 브리핑이 ready면 보낸다.
    1일이 휴일이면 다음 영업일에 나간다(배치가 영업일에만 보내므로). 10일이 지나면 자동 발송하지 않는다."""
    from app.models.company_report import MonthlyBriefing
    from app.services.collectors import data_go_kr
    from app.services.company_report import monthly
    from app.services.company_report.keys import get_service_key

    day = day or today_kst()
    if not await settings_store.get_bool(db, config.BRIEFING_ENABLED, default=False):
        return {"skipped": "발송 꺼짐(발송 설정에서 켜기)"}
    if not await settings_store.get_bool(db, config.MONTHLY_ENABLED, default=True):
        return {"skipped": "월간 발송 꺼짐"}
    month = monthly.target_month_for(day)
    mb = (await db.execute(select(MonthlyBriefing).where(MonthlyBriefing.month == month))).scalar_one_or_none()
    if not mb:
        return {"skipped": f"{month} 월간 브리핑 없음"}
    if mb.status == "sent":
        return {"skipped": "이미 발송됨"}
    if mb.status != "ready" and not (mb.status == "failed" and mb.approved_at):
        return {"held": f"{mb.status} — {mb.hold_reason or '관리자 확인 필요'}"}
    if not ignore_day:
        if day.day > 10:
            return {"skipped": "10일이 지나 자동 발송하지 않음(관리자가 [지금 발송])"}
        dg = await get_service_key(db, "data_go_kr")
        if not await data_go_kr.is_business_day(dg[0] if dg else None, day):
            return {"skipped": "영업일이 아님"}
    targets = await recipients(db)
    if not targets:
        return {"skipped": "수신자 없음"}
    r = await _deliver_monthly(db, mb, targets, "monthly")
    if r["success"]:
        mb.status, mb.sent_at = "sent", now_kst()
    else:
        mb.status = "failed"
        mb.approved_at = mb.approved_at or now_kst()  # 다음 배치에서 재시도 허용
    await db.commit()
    return {**r, "month": month}


async def send_monthly_test(db: AsyncSession, monthly_id: str, user: User, recipient_id: Optional[str] = None,
                            view=None) -> dict:
    from app.models.company_report import MonthlyBriefing

    mb = await db.get(MonthlyBriefing, monthly_id)
    if not mb:
        return {"success": False, "error": "월간 브리핑이 없습니다."}
    if recipient_id:
        t = next((x for x in await recipient_targets(db, include_no_phone=True, list_owner=_list_of(view))
                  if x.recipient_id == recipient_id), None)
        if not t or not t.phone:
            return {"success": False, "error": "수신자를 찾을 수 없거나 휴대폰 번호가 없습니다."}
        target = t
    else:
        if not user.phone:
            return {"success": False, "error": "내 계정에 휴대폰 번호가 없습니다. 오른쪽 위 이름 > 내 정보에서 휴대폰 번호를 저장해 주세요."}
        target = await _self_target(user, view)
    r = await _deliver_monthly(db, mb, [target], "test")
    await db.commit()
    return {**r, "to": target.name}
