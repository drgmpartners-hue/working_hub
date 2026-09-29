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
LIMIT_MARKETS = 130


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


# --------------------------------------------------------------------------- 데일리(템플릿 B v2 — 본문에 기사 링크)
# 카톡에서 바로 읽도록: 요약 문장 끝에 [1][2] 번호, 맨 아래 '■ 기사 원문 링크'에 번호별 짧은 주소.
# 알림톡은 변수를 채운 뒤 1,000자 이내, LMS 대체 발송은 2,000바이트 이내여야 해서 줄 수를 자동으로 줄인다.

TEMPLATE_B = """[사내 업무용 메시지]
#{담당자명} 담당자님, 오늘의 투자기업 데일리 브리핑입니다.

본 메시지는 사내 업무 시스템(Working Hub)에 투자기업 브리핑 수신자로 등록된 임직원께 평일 오전 발송되는 업무 알림입니다.

■ 기본정보
#{날짜} | #{날씨}
#{전일증시}
대상 #{기업수}개 기업 · 기사 #{기사수}건 · 주의 #{주의수}건

■ 종합브리핑
#{종합브리핑}

■ 기업별 브리핑
#{기업별요약}

■ 기사 원문 링크
#{기사링크}"""

MAX_CHARS = 990      # 알림톡 1,000자
MAX_BYTES = 1990     # LMS 2,000바이트(EUC-KR 기준 한글 2바이트)
MAX_REFS = 2         # 문장 하나에 붙이는 번호 수
LINE_CUT = 60        # 기업별 한 줄 길이


def fill(template: str, v: dict[str, str]) -> str:
    out = template
    for k, val in v.items():
        out = out.replace(k, val)
    return out


def _fits(text: str) -> bool:
    return len(text) <= MAX_CHARS and len(text.encode("euc-kr", errors="replace")) <= MAX_BYTES


class _Numbers:
    """본문에 나오는 순서대로 기사 번호를 매긴다(링크가 있는 기사만)."""

    def __init__(self, links: dict[str, str]):
        self.links, self.order = links, []

    def ref(self, keys: list[str]) -> str:
        out = []
        for k in keys:
            if k not in self.links:
                continue
            if k not in self.order:
                self.order.append(k)
            n = self.order.index(k) + 1
            if n not in out:
                out.append(n)
            if len(out) >= MAX_REFS:
                break
        return "".join(f"[{n}]" for n in out)

    def block(self) -> str:
        return "\n".join(f"[{i}] {self.links[k]}" for i, k in enumerate(self.order, 1))


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


def daily_link_candidates(b: NewsBriefing) -> list[tuple[str, str]]:
    """짧은 주소를 만들 기사 [(url, article_id)] — 종합 문장 출처 + 기업별 대표 기사."""
    lines, cards = _daily_parts(b)
    urls = {a["id"]: a.get("url") for c in cards for a in c.get("articles") or [] if a.get("url")}
    want: list[str] = []
    for ln in lines:
        want += ln["article_ids"][:MAX_REFS]
    for c in cards:
        top = next((a for a in c.get("articles") or [] if not a.get("more")), None)
        if top:
            want.append(top["id"])
    seen, out = set(), []
    for aid in want:
        if aid in urls and aid not in seen:
            seen.add(aid)
            out.append((urls[aid], aid))
    return out


def template_b_variables(b: NewsBriefing, name: str = "", links: Optional[dict[str, str]] = None) -> dict[str, str]:
    """links: 기사 id → 짧은 주소. 1,000자에 맞춰 기업·문장 수를 줄인다."""
    links = links or {}
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
        "#{날짜코드}": d.isoformat(),  # v1 템플릿(버튼) 호환
    }

    def build(n_over: int, n_comp: int, cut_over: int) -> dict[str, str]:
        nums = _Numbers(links)
        over = []
        for ln in lines[:n_over]:
            r = nums.ref(ln["article_ids"])
            over.append(f"- {_cut(ln['text'], cut_over)}{(' ' + r) if r else ''}")
        comp = []
        for c in cards[:n_comp]:
            top = next((a for a in c.get("articles") or [] if not a.get("more")), None)
            r = nums.ref([top["id"]]) if top else ""
            flag = " [주의]" if c.get("caution_count") else ""
            comp.append(f"· {c['name']}{flag}: {_cut(c.get('one_liner') or '', LINE_CUT)}{(' ' + r) if r else ''}")
        if len(cards) > n_comp:
            comp.append(f"외 {len(cards) - n_comp}개 기업(Working Hub에서 확인)")
        return {**base,
                "#{종합브리핑}": "\n".join(over) or "-",
                "#{기업별요약}": "\n".join(comp) or "새 기사가 없습니다.",
                "#{기사링크}": nums.block() or "(링크 없음)"}

    n_over, n_comp, cut_over = min(len(lines), 4), min(len(cards), 5), 110
    v = build(n_over, n_comp, cut_over)
    while not _fits(fill(TEMPLATE_B, v)):
        if n_comp > 3:
            n_comp -= 1
        elif cut_over > 60:
            cut_over -= 10
        elif n_over > 2:
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


def render_text(b: NewsBriefing, name: str = "", links: Optional[dict[str, str]] = None) -> str:
    """템플릿 B v2와 같은 본문(LMS 대체 발송·미리보기)."""
    return fill(TEMPLATE_B, template_b_variables(b, name, links))


async def daily_links(db: AsyncSession, b: NewsBriefing) -> dict[str, str]:
    """기사 id → 짧은 주소."""
    from app.services.company_report import shortlink

    cands = daily_link_candidates(b)
    by_url = await shortlink.codes_for(db, cands)
    return {aid: by_url[u] for u, aid in cands if u in by_url}


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


async def _deliver_generic(db: AsyncSession, briefing_id: str, targets: list, briefing_type: str, template_key: str,
                           subject: str, text_fn, vars_fn) -> dict:
    template_id = await settings_store.get(db, template_key)
    # 수신자마다 #{담당자명}이 달라서 본문·변수를 한 명씩 만든다
    msgs = [{
        "to": t.phone, "text": text_fn(t.name), "subject": subject,
        **({"template_id": template_id, "variables": vars_fn(t.name)} if template_id else {}),
    } for t in targets]
    res = await solapi_service.send_many_alimtalk(db, msgs)
    ok = bool(res.get("success"))
    channel = "alimtalk" if template_id else "lms"
    for t in targets:
        db.add(BriefingSendLog(
            briefing_type=briefing_type, briefing_id=briefing_id, user_id=getattr(t, "user_id", None) or getattr(t, "id", None),
            phone=t.phone, channel=channel,
            status="requested" if ok else "failed", solapi_group_id=res.get("groupId") or (res.get("groupInfo") or {}).get("groupId"),
            error=None if ok else str(res.get("error") or res.get("errorMessage") or res)[:1000],
        ))
    return {"success": ok, "channel": channel, "count": len(targets), "error": None if ok else res.get("error") or res.get("errorMessage")}


async def _deliver(db: AsyncSession, b: NewsBriefing, targets: list, briefing_type: str) -> dict:
    links = await daily_links(db, b)
    return await _deliver_generic(
        db, b.id, targets, briefing_type, config.TEMPLATE_DAILY, "[사내] 투자기업 데일리 브리핑",
        lambda name: render_text(b, name, links), lambda name: template_b_variables(b, name, links),
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


# --------------------------------------------------------------------------- 월간(템플릿 C)

MONTHLY_INTRO = "본 메시지는 사내 업무 시스템(Working Hub)에 투자기업 브리핑 수신자로 등록된 임직원께 매월 초 발송되는 업무 알림입니다."


def monthly_url(month: str) -> str:
    return f"{config.WEB_BASE}/content/company-report/briefing?month={month}"


TEMPLATE_C = """[사내 업무용 메시지]
#{담당자명} 담당자님, #{월} 투자기업 월간 브리핑입니다.

본 메시지는 사내 업무 시스템(Working Hub)에 투자기업 브리핑 수신자로 등록된 임직원께 매월 초 발송되는 업무 알림입니다.

■ #{월} 요약
#{월간요약}

■ 주목할 기업
#{주목기업}

■ 주의가 필요한 기업
#{주의기업}

■ 다음 달 체크포인트
#{체크포인트}

■ 기사 원문 링크
#{기사링크}"""


def monthly_link_candidates(mb, fact_urls: Optional[dict[str, str]] = None) -> list[tuple[str, str]]:
    """출처 id(A#/F#) 중 링크가 되는 것 [(url, 출처 id)]. 사실(F#)은 근거 기사 주소를 쓴다."""
    c = mb.content or {}
    src = c.get("sources") or {}
    fact_urls = fact_urls or {}
    ids: list[str] = []
    for x in (c.get("summary") or []) + (c.get("highlights") or []):
        ids += (x.get("source_ids") or [])[:MAX_REFS]
    for x in c.get("cautions") or []:
        ids += ((x.get("what") or {}).get("source_ids") or [])[:MAX_REFS]
    for x in c.get("checkpoints") or []:
        ids += (x.get("source_ids") or [])[:1]
    out, seen = [], set()
    for sid in ids:
        if sid in seen or sid not in src:
            continue
        seen.add(sid)
        info = src[sid]
        url = info.get("url") if info.get("type") == "article" else fact_urls.get(info.get("id", ""))
        if url:
            out.append((url, sid))
    return out


def template_c_variables(mb, name: str = "", links: Optional[dict[str, str]] = None) -> dict[str, str]:
    """links: 출처 id → 짧은 주소. 1,000자에 맞춰 줄 수를 줄인다."""
    links = links or {}
    c = mb.content or {}
    m = mb.month
    st = mb.stats or {}
    base = {"#{담당자명}": (name or "").strip() or "사내", "#{월}": f"{int(m[5:7])}월", "#{월코드}": m}

    def when_txt(x):
        w = x.get("when") or ""
        return f"{int(w[5:7])}월 " if len(w) == 7 and w[4] == "-" else ""

    def build(n: int, cut: int) -> dict[str, str]:
        nums = _Numbers(links)

        def line(prefix: str, text: str, ids: list[str]) -> str:
            r = nums.ref(ids or [])
            return f"{prefix}{_cut(text, cut)}{(' ' + r) if r else ''}"

        summ = [line("- ", x["text"], x.get("source_ids")) for x in (c.get("summary") or [])[:n + 1]]
        hi = [line(f"· {x.get('name') or ''}: ", x["text"], x.get("source_ids")) for x in (c.get("highlights") or [])[:n]]
        cau = [line(f"· {x['name']}: ", (x.get("what") or {}).get("text", ""), (x.get("what") or {}).get("source_ids"))
               for x in (c.get("cautions") or [])[:n]]
        cps = [line(f"· {when_txt(x)}{x['name']}: ", x["text"], (x.get("source_ids") or [])[:1])
               for x in (c.get("checkpoints") or [])[:n]]
        return {**base,
                "#{월간요약}": "\n".join(summ) or f"- 기사 {st.get('article_count', 0)}건, 주의 {st.get('caution_count', 0)}건",
                "#{주목기업}": "\n".join(hi) or "없음",
                "#{주의기업}": "\n".join(cau) or "없음",
                "#{체크포인트}": "\n".join(cps) or "없음",
                "#{기사링크}": nums.block() or "(링크 없음)"}

    n, cut = 4, 90
    v = build(n, cut)
    while not _fits(fill(TEMPLATE_C, v)):
        if cut > 60:
            cut -= 10
        elif n > 1:
            n -= 1
        else:
            break
        v = build(n, cut)
    return v


def monthly_url(month: str) -> str:
    return f"{config.WEB_BASE}/content/company-report/briefing?month={month}"


def render_monthly_text(mb, name: str = "", links: Optional[dict[str, str]] = None) -> str:
    return fill(TEMPLATE_C, template_c_variables(mb, name, links))


async def monthly_links(db: AsyncSession, mb) -> dict[str, str]:
    """출처 id → 짧은 주소. 사실(F#)은 원장 사실의 근거 기사 주소로."""
    from app.models.company_report import CompanyFact
    from app.services.company_report import shortlink

    src = (mb.content or {}).get("sources") or {}
    fact_ids = [v["id"] for v in src.values() if v.get("type") == "fact" and v.get("id")]
    fact_urls: dict[str, str] = {}
    if fact_ids:
        for f in (await db.execute(select(CompanyFact).where(CompanyFact.id.in_(fact_ids)))).scalars():
            u = next((r.get("url") for r in f.source_refs or [] if isinstance(r, dict) and r.get("url")), None)
            if u:
                fact_urls[f.id] = u
    cands = monthly_link_candidates(mb, fact_urls)
    by_url = await shortlink.codes_for(db, cands)
    return {sid: by_url[u] for u, sid in cands if u in by_url}


async def _deliver_monthly(db: AsyncSession, mb, targets: list, briefing_type: str) -> dict:
    links = await monthly_links(db, mb)
    return await _deliver_generic(
        db, mb.id, targets, briefing_type, config.TEMPLATE_MONTHLY, "[사내] 투자기업 월간 브리핑",
        lambda name: render_monthly_text(mb, name, links), lambda name: template_c_variables(mb, name, links),
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


async def send_monthly_test(db: AsyncSession, monthly_id: str, user: User, recipient_id: Optional[str] = None) -> dict:
    from app.models.company_report import MonthlyBriefing

    mb = await db.get(MonthlyBriefing, monthly_id)
    if not mb:
        return {"success": False, "error": "월간 브리핑이 없습니다."}
    if recipient_id:
        t = next((x for x in await recipient_targets(db, include_no_phone=True) if x.recipient_id == recipient_id), None)
        if not t or not t.phone:
            return {"success": False, "error": "수신자를 찾을 수 없거나 휴대폰 번호가 없습니다."}
        target = t
    else:
        if not user.phone:
            return {"success": False, "error": "내 계정에 휴대폰 번호가 없습니다. 발송 설정의 수신자 옆 [테스트]로 보내 보세요."}
        target = Target(None, user.nickname, user.phone, user_id=user.id)
    r = await _deliver_monthly(db, mb, [target], "test")
    await db.commit()
    return {**r, "to": target.name}
