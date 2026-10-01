"""반기 보고서 자료 요청 (P4-4) — 기업별 체크리스트 + 6월 말·12월 말 알림.

- 체크리스트는 app_settings 'doc_request:{기업id}:{2026H1}' 에 JSON 으로 둔다(기업·반기별).
- 항목마다 '받음' 표시를 직접 할 수 있고, 자료함(03_자료)에 그 종류 문서가 반기 시작 이후 올라오면 자동으로 '받음(자동)'.
- 알림: 6/30·12/30 09:00(KST) 그 기업을 목록에 둔 사람(대표·매니저)에게 문자 1통 — "곧 보고서 철이니 자료를 받아 두세요".
  발송 켜기(news_briefing_enabled)가 꺼져 있으면 보내지 않는다.
- 화면: 기업 상세 > 반기 보고서 탭의 '자료 요청' 칸, 그리고 알림 기간(6/15~7/31, 12/15~1/31)에는 안내 띠.
"""
from __future__ import annotations

import json
from datetime import date, datetime
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.services import settings_store
from app.services.company_report.timeutil import now_kst, today_kst

ITEMS = [
    ("ir", "IR 자료(최신 회사 소개)", ("ir", "product")),
    ("financial", "재무제표(반기·결산) 또는 감사보고서", ("financial",)),
    ("shareholders", "주주명부·지분 변동", ("shareholders",)),
    ("investor_report", "투자사(VC) 보고서", ("investor_report",)),
    ("press", "보도자료·수상·인증", ("press", "certificate")),
    ("etc", "기타(계약·제휴·신제품 소식)", ("contract", "other")),
]


def period_key(year: int, half: int) -> str:
    return f"{year}H{half}"


def target_half(today: Optional[date] = None) -> tuple[int, int]:
    """자료를 받을 반기: 6/15~12/14 → 그해 상반기, 12/15~이듬해 6/14 → 하반기(1~6월이면 작년 하반기)."""
    t = today or today_kst()
    md = (t.month, t.day)
    if (6, 15) <= md < (12, 15):
        return t.year, 1
    return (t.year, 2) if md >= (12, 15) else (t.year - 1, 2)


def in_request_season(today: Optional[date] = None) -> bool:
    t = today or today_kst()
    md = (t.month, t.day)
    return (6, 15) <= md <= (7, 31) or md >= (12, 15) or md <= (1, 31)


def _key(company_id: str, year: int, half: int) -> str:
    return f"doc_request:{company_id}:{period_key(year, half)}"


async def _load(db: AsyncSession, company_id: str, year: int, half: int) -> dict:
    raw = await settings_store.get(db, _key(company_id, year, half))
    try:
        d = json.loads(raw) if raw else {}
    except ValueError:
        d = {}
    return d if isinstance(d, dict) else {}


async def checklist(db: AsyncSession, company_id: str, year: int, half: int) -> dict:
    from app.models.company_report import CompanyDocument
    from app.services.company_report.half_year import half_label, half_range

    saved = await _load(db, company_id, year, half)
    marks = saved.get("items") or {}
    start, _ = half_range(year, half)
    docs = (await db.execute(select(CompanyDocument.doc_type, CompanyDocument.filename, CompanyDocument.created_at).where(
        CompanyDocument.company_id == company_id, CompanyDocument.created_at >= datetime(start.year, start.month, start.day)))).all()
    items = []
    for key, label, types in ITEMS:
        auto = [f for (t, f, _) in docs if t in types]
        m = marks.get(key) or {}
        items.append({"key": key, "label": label, "done": bool(m.get("done")) or bool(auto), "manual": bool(m.get("done")),
                      "auto_files": auto[:5], "note": m.get("note") or "", "updated_at": m.get("at")})
    return {"company_id": company_id, "year": year, "half": half, "period_label": half_label(year, half),
            "items": items, "done": sum(1 for x in items if x["done"]), "total": len(items),
            "requested_at": saved.get("requested_at"), "season": in_request_season()}


async def mark(db: AsyncSession, company_id: str, year: int, half: int, key: str, *, done: Optional[bool] = None,
               note: Optional[str] = None, user_id: Optional[str] = None, requested: bool = False) -> dict:
    if key not in {k for k, _, _ in ITEMS} and not requested:
        raise ValueError("없는 항목입니다.")
    d = await _load(db, company_id, year, half)
    if requested:
        d["requested_at"] = now_kst().isoformat(timespec="seconds")
    else:
        it = (d.setdefault("items", {})).setdefault(key, {})
        if done is not None:
            it["done"] = bool(done)
        if note is not None:
            it["note"] = note.strip()[:300]
        it["at"], it["by"] = now_kst().isoformat(timespec="seconds"), user_id
    await settings_store.set_value(db, _key(company_id, year, half), json.dumps(d, ensure_ascii=False))
    return await checklist(db, company_id, year, half)


async def member_targets(db: AsyncSession) -> dict[str, dict]:
    """{user_id: {name, phone, companies:[(id, name)]}} — 활성 기업을 목록에 둔 활성 사용자(휴대폰 있는 사람만)."""
    from app.models.news_briefing import CompanyMember, PortfolioCompany
    from app.models.user import User

    rows = (await db.execute(
        select(User.id, User.nickname, User.phone, PortfolioCompany.id, PortfolioCompany.name)
        .join(CompanyMember, CompanyMember.user_id == User.id)
        .join(PortfolioCompany, PortfolioCompany.id == CompanyMember.company_id)
        .where(User.is_active == True, PortfolioCompany.is_active == True, PortfolioCompany.deleted_at.is_(None))  # noqa: E712
        .order_by(User.nickname, PortfolioCompany.name))).all()
    out: dict[str, dict] = {}
    for uid, name, phone, cid, cname in rows:
        if not phone:
            continue
        out.setdefault(uid, {"name": name, "phone": phone, "companies": []})["companies"].append((cid, cname))
    return out


def notice_text(name: str, companies: list[str], period: str) -> str:
    shown = ", ".join(companies[:8]) + (f" 외 {len(companies) - 8}곳" if len(companies) > 8 else "")
    return (f"[Working Hub] {name}님, {period} 반기 보고서 자료를 받을 때입니다.\n"
            f"담당 기업 {len(companies)}곳: {shown}\n\n"
            "IR 자료·재무제표·주주명부·투자사 보고서·보도자료를 받아 기업 상세 > 기업DB '03_자료'에 올려 주세요. "
            "보고서는 1/31·7/31 새벽에 자동으로 만들어집니다.")


async def notify(db: AsyncSession, *, dry_run: bool = False, today: Optional[date] = None) -> dict:
    from app.services import solapi_service
    from app.services.company_report import config
    from app.services.company_report.half_year import half_label

    year, half = target_half(today)
    period = half_label(year, half)
    targets = await member_targets(db)
    if not dry_run and not await settings_store.get_bool(db, config.BRIEFING_ENABLED, default=False):
        return {"sent": 0, "skipped": "발송 꺼짐", "targets": len(targets)}
    msgs = [{"to": t["phone"], "text": notice_text(t["name"], [n for _, n in t["companies"]], period),
             "subject": f"[Working Hub] {period} 보고서 자료 요청"} for t in targets.values()]
    if dry_run or not msgs:
        return {"sent": 0, "targets": len(msgs), "dry_run": dry_run, "preview": msgs[:1]}
    res = await solapi_service.send_many_alimtalk(db, msgs)
    cids = {cid for t in targets.values() for cid, _ in t["companies"]}
    if res.get("success"):
        for cid in cids:
            await mark(db, cid, year, half, "", requested=True)
    return {"sent": len(msgs) if res.get("success") else 0, "targets": len(msgs), "error": None if res.get("success") else res.get("error")}
