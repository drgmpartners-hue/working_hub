"""반기 보고서 고객 전달 — 카톡(알림톡)·문자 링크 발송과 고객용 폰 화면 (P4-10, 2026-10-01 결정: 출력·발송 둘 다).

- 링크: {WEB_BASE}/m/report?t={보고서id}.{고객id}.{만료일}.{서명} — 로그인 없이 그 고객용 보고서만 열린다(180일)
- 고객 화면에는 내부 정보(영업 노트·검토 의견·확인 필요 표시)를 빼고, 그 고객 담당 매니저 연락처를 붙인다
- 발송은 '검토 완료'된 보고서만. 매니저는 자기 담당 고객에게만 보낼 수 있다(권한 규칙)
- 알림톡 템플릿(설정 키 report_template_id)이 승인되기 전에는 같은 내용을 문자(LMS)로 보낸다
- 보낸 기록: report_exports(format='link') + briefing_send_logs(briefing_type='report')
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import re
from datetime import date, timedelta
from typing import Optional

from app.core.config import settings
from app.services.company_report import config
from app.services.company_report.timeutil import now_kst, today_kst

VALID_DAYS = 180
SIG_LEN = 16
TEMPLATE_KEY = "report_template_id"
_UUID = re.compile(r"^[0-9a-f-]{36}$")


class ShareError(ValueError):
    pass


def _sig(report_id: str, client_id: str, exp: str) -> str:
    mac = hmac.new(settings.SECRET_KEY.encode(), f"cr-report|{report_id}|{client_id}|{exp}".encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(mac).decode().rstrip("=")[:SIG_LEN]


def make(report_id: str, client_id: str, today: Optional[date] = None) -> str:
    if not _UUID.match(report_id or "") or not _UUID.match(client_id or ""):
        raise ShareError("잘못된 값")
    exp = ((today or today_kst()) + timedelta(days=VALID_DAYS)).strftime("%Y%m%d")
    return f"{report_id}.{client_id}.{exp}.{_sig(report_id, client_id, exp)}"


def parse(token: str, today: Optional[date] = None) -> tuple[str, str]:
    parts = (token or "").strip().split(".")
    if len(parts) != 4:
        raise ShareError("링크 형식이 올바르지 않습니다.")
    rid, cid, exp, sig = parts
    if not _UUID.match(rid) or not _UUID.match(cid) or not re.match(r"^\d{8}$", exp):
        raise ShareError("링크 형식이 올바르지 않습니다.")
    if not hmac.compare_digest(sig, _sig(rid, cid, exp)):
        raise ShareError("링크가 올바르지 않습니다.")
    if (today or today_kst()).strftime("%Y%m%d") > exp:
        raise ShareError("링크 사용 기간이 지났습니다. 담당자에게 다시 요청해 주세요.")
    return rid, cid


def page_url(token: str) -> str:
    return f"{config.WEB_BASE}/m/report?t={token}"


def public_content(content: dict) -> dict:
    """고객에게 보여 줄 본문: 내부 표시(확인 필요·검토 의견·수정 표시)를 뺀다."""
    import copy

    c = copy.deepcopy(content or {})

    def clean(x: dict) -> dict:
        for k in ("disputed", "review_note", "edited", "resolved"):
            x.pop(k, None)
        return x

    sm = c.get("summary") or {}
    for k in ("three_lines", "changes"):
        sm[k] = [clean(x) for x in sm.get(k) or []]
    if sm.get("stage_note"):
        clean(sm["stage_note"])
    for sec in c.get("sections") or []:
        for blk in sec.get("blocks") or []:
            for x in blk.get("items") or blk.get("rows") or []:
                clean(x)
    ap = c.get("appendix") or {}
    v = ap.get("verification") or {}
    v.pop("disputed", None)
    c.pop("stats", None)
    return c


# 알림톡 템플릿 D(심사용 문안 — docs/company_report/alimtalk_templates.md). 승인 전에는 같은 내용 문자.
TEMPLATE_D = """#{고객명} 고객님, 안녕하세요.
Dr.GM Family Office 입니다.

#{기업명}의 #{반기} 기업 종합보고서를 보내 드립니다.

■ 핵심 요약
#{핵심요약}

아래 버튼에서 전체 보고서를 보실 수 있습니다.
궁금하신 점은 담당 #{담당자}에게 편하게 연락 주세요."""
BUTTON_TAIL = "아래 버튼에서 전체 보고서를 보실 수 있습니다."


def variables(client_name: str, company: str, period: str, lines: list[str], manager: str) -> dict[str, str]:
    summary = "\n".join(f"- {x}" for x in lines[:3]) or "- 보고서에서 확인해 주세요."
    return {"#{고객명}": client_name, "#{기업명}": company, "#{반기}": period, "#{핵심요약}": summary[:400],
            "#{담당자}": manager}


def fill(template: str, v: dict[str, str]) -> str:
    out = template
    for k, val in v.items():
        out = out.replace(k, val)
    return out


def lms_text(v: dict[str, str], url: str) -> str:
    return fill(TEMPLATE_D, v).replace(BUTTON_TAIL, f"아래 주소에서 전체 보고서를 보실 수 있습니다.\n{url}")


async def send(db, report, clients: list, sender) -> dict:
    """고객 여러 명에게 보고서 링크를 보낸다. clients: Client 목록(권한 확인 끝난 것)."""
    from app.models.company_report import ReportExport
    from app.models.news_briefing import BriefingSendLog, PortfolioCompany
    from app.models.user import User
    from app.services import settings_store, solapi_service
    from app.services.company_report.half_year import half_label

    company = await db.get(PortfolioCompany, report.company_id)
    period = half_label(report.period_year, report.period_half)
    lines = [x.get("text", "") for x in ((report.content or {}).get("summary") or {}).get("three_lines") or []]
    template_id = await settings_store.get(db, TEMPLATE_KEY)
    msgs, targets, skipped = [], [], []
    for cl in clients:
        if not cl.phone:
            skipped.append(f"{cl.name}(휴대폰 번호 없음)")
            continue
        mgr = await db.get(User, cl.user_id) if cl.user_id else None
        manager = " ".join(x for x in [(mgr.nickname if mgr else sender.nickname), (mgr.phone if mgr else sender.phone) or ""] if x)
        token = make(report.id, cl.id)
        url = page_url(token)
        v = variables(cl.name, company.name if company else "", period, lines, manager)
        if template_id:
            msgs.append({"to": cl.phone, "text": fill(TEMPLATE_D, v), "subject": f"[Dr.GM] {company.name if company else ''} 보고서",
                         "template_id": template_id, "variables": {**v, "#{링크}": token}})
        else:
            msgs.append({"to": cl.phone, "text": lms_text(v, url), "subject": f"[Dr.GM] {company.name if company else ''} {period} 보고서"})
        targets.append(cl)
    if not msgs:
        return {"success": False, "sent": 0, "skipped": skipped, "error": "보낼 수 있는 고객이 없습니다."}
    res = await solapi_service.send_many_alimtalk(db, msgs)
    ok = bool(res.get("success"))
    for cl in targets:
        db.add(BriefingSendLog(briefing_type="report", briefing_id=report.id, user_id=sender.id, phone=cl.phone,
                               recipient_name=cl.name, channel="alimtalk" if template_id else "lms",
                               status="requested" if ok else "failed",
                               error=None if ok else str(res.get("error") or res)[:1000]))
        if ok:
            db.add(ReportExport(report_id=report.id, version=report.version, format="link", client_id=cl.id, exported_by=sender.id,
                                    exported_at=now_kst()))
    await db.commit()
    return {"success": ok, "sent": len(targets) if ok else 0, "channel": "alimtalk" if template_id else "lms",
            "skipped": skipped, "error": None if ok else (res.get("error") or res.get("errorMessage"))}
