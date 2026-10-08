"""반기 보고서 관리 — 기업별로 '지금 쓸 보고서' 고르기, 진행 현황, 일괄 출력(zip), 고객 보고서 연동 (P4-8·P4-10).

'지금 쓸 보고서' 고르는 순서(그 사람 기준):
  ① 내 버전 중 검토 완료된 최신  ② 내 버전 중 검토 중인 최신
  ③ 공식본(검토 담당이 검토 완료한 버전, 2026-10-08) 최신  ④ 공용 자동 생성본 최신(검토 중·완료)
대표는 공용본과 모든 사람의 버전을 본다(개인 버전은 '누가 고쳤는지'와 함께).
"""
from __future__ import annotations

import io
import zipfile
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.company_report import CompanyReport, ReportExport
from app.models.news_briefing import PortfolioCompany

READY = ("draft", "final")


def is_official(r: CompanyReport) -> bool:
    return bool(getattr(r, "official", False)) and r.status == "final"


def _rank(r: CompanyReport, user_id: str) -> tuple:
    mine = r.owner_user_id == user_id
    return (
        3 if (mine and r.status == "final") else 2 if (mine and r.status == "draft") else 1 if is_official(r)
        else 0 if r.owner_user_id is None else -1,
        r.version,
        r.created_at.isoformat() if r.created_at else "",
    )


def can_read(r: CompanyReport, user) -> bool:
    """그 기업을 볼 수 있는 사람 기준: 공용본·공식본·내 버전은 보고, 남의 개인 버전은 대표만."""
    from app.core.permissions import is_owner

    return r.owner_user_id in (None, user.id) or is_official(r) or is_owner(user)


def can_send(r: CompanyReport, user) -> bool:
    """고객에게 보낼 수 있는 버전: 검토 완료된 내 버전 또는 공식본(대표는 모두)."""
    from app.core.permissions import is_owner

    return r.status == "final" and (r.owner_user_id == user.id or is_official(r) or is_owner(user))


async def reports_for(db: AsyncSession, company_ids: list[str], year: int, half: int) -> dict[str, list[CompanyReport]]:
    if not company_ids:
        return {}
    rows = (await db.execute(select(CompanyReport).where(
        CompanyReport.company_id.in_(company_ids), CompanyReport.period_year == year,
        CompanyReport.period_half == half))).scalars().all()
    out: dict[str, list[CompanyReport]] = {}
    for r in rows:
        out.setdefault(r.company_id, []).append(r)
    return out


def pick(reports: list[CompanyReport], user_id: str) -> Optional[CompanyReport]:
    """완성된 보고서 중 이 사람이 지금 쓸 것(없으면 None). 남의 개인 버전은 고르지 않는다(공식본은 예외)."""
    cands = [r for r in reports if r.status in READY and r.content and (r.owner_user_id in (None, user_id) or is_official(r))]
    return max(cands, key=lambda r: _rank(r, user_id)) if cands else None


def stage_of(reports: list[CompanyReport], user_id: str) -> str:
    """진행 단계: none(아직 없음) / generating / failed / draft(검토 중) / final(검토 완료)."""
    p = pick(reports, user_id)
    if p is not None:
        return p.status
    if any(r.status == "generating" and r.owner_user_id is None for r in reports):
        return "generating"
    if any(r.status == "failed" and r.owner_user_id is None for r in reports):
        return "failed"
    return "none"


async def overview(db: AsyncSession, user, company_ids: list[str], year: int, half: int) -> list[dict]:
    from app.core.permissions import is_owner
    from app.services.company_report import report_edit
    from app.services.company_report import visibility as vis

    companies = (await db.execute(select(PortfolioCompany).where(
        PortfolioCompany.id.in_(company_ids), PortfolioCompany.deleted_at.is_(None),
        PortfolioCompany.is_active == True).order_by(PortfolioCompany.name))).scalars().all() \
        if company_ids else []
    by_c = await reports_for(db, [c.id for c in companies], year, half)
    members = await vis.member_names(db, [c.id for c in companies])
    owner = is_owner(user)
    all_ids = [r.id for rs in by_c.values() for r in rs]
    exp_rows = (await db.execute(select(ReportExport.report_id, ReportExport.format).where(
        ReportExport.report_id.in_(all_ids)))).all() if all_ids else []
    exp_count: dict[str, int] = {}
    sent_count: dict[str, int] = {}
    for rid, fmt in exp_rows:
        (sent_count if fmt == "link" else exp_count)[rid] = (sent_count if fmt == "link" else exp_count).get(rid, 0) + 1
    out = []
    for c in companies:
        rs = by_c.get(c.id, [])
        p = pick(rs, user.id)
        off = max((r for r in rs if is_official(r)), key=lambda r: (r.version, r.created_at.isoformat() if r.created_at else ""),
                  default=None)
        others = []
        if owner:  # 대표: 매니저별 개인 버전 진행도 함께 본다
            seen = {}
            for r in sorted(rs, key=lambda r: (r.version, r.created_at.isoformat() if r.created_at else "")):
                if r.owner_user_id and r.owner_user_id != user.id and r.status in READY and not is_official(r):
                    seen[r.owner_user_id] = r
            others = [{"report_id": r.id, "owner_user_id": uid, "status": r.status, "version": r.version} for uid, r in seen.items()]
        out.append({
            "company_id": c.id, "company_name": c.name, "listed": bool(getattr(c, "stock_code", None)),
            "members": members.get(c.id, []), "stage": stage_of(rs, user.id),
            "reviewers": [m for m in members.get(c.id, []) if m.get("reviewer")],
            # 공식본(검토 담당이 검토 완료): 누가 언제 했는지 — 없으면 None
            "official": None if off is None else {"report_id": off.id, "version": off.version,
                                                  "by_user_id": off.finalized_by,
                                                  "at": off.finalized_at.isoformat() if off.finalized_at else None},
            "report": None if p is None else {
                "id": p.id, "status": p.status, "version": p.version, "mine": p.owner_user_id == user.id,
                "official": is_official(p), "can_send": can_send(p, user),
                "disputed": report_edit.disputed_count(p.content or {}),
                "updated_at": p.updated_at.isoformat() if p.updated_at else None,
                "exports": exp_count.get(p.id, 0), "sends": sent_count.get(p.id, 0),
            },
            "generating": any(r.status == "generating" for r in rs),
            "others": others,
        })
    return out


async def batch_zip(db: AsyncSession, user, company_ids: list[str], year: int, half: int, fmt: str) -> tuple[bytes, str, list[str]]:
    """여러 기업 보고서를 한 zip 으로. (zip 바이트, 파일 이름, 빠진 기업 안내)."""
    from app.services.company_report import exporters
    from app.services.company_report.half_year import half_label

    by_c = await reports_for(db, company_ids, year, half)
    names = dict((await db.execute(select(PortfolioCompany.id, PortfolioCompany.name).where(
        PortfolioCompany.id.in_(company_ids)))).all()) if company_ids else {}
    buf = io.BytesIO()
    skipped, used = [], set()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for cid in company_ids:
            r = pick(by_c.get(cid, []), user.id)
            if r is None:
                skipped.append(f"{names.get(cid, cid)}(완성된 보고서 없음)")
                continue
            data, fname, _ = await exporters.export(db, r, fmt, user_id=user.id)
            while fname in used:
                fname = "_" + fname
            used.add(fname)
            z.writestr(fname, data)
        if skipped:
            z.writestr("_빠진_기업.txt", "\n".join(skipped))
    return buf.getvalue(), f"반기보고서_{half_label(year, half).replace(' ', '_')}_{fmt}.zip", skipped


def content_view(r: CompanyReport) -> dict:
    """고객자산관리 종합 보고서에 넣을 요약(내부 표시는 뺀다)."""
    from app.services.company_report import report_share
    from app.services.company_report.half_year import half_label

    c = report_share.public_content(r.content or {})
    sm = c.get("summary") or {}
    return {
        "report_id": r.id, "company_id": r.company_id, "period_label": half_label(r.period_year, r.period_half),
        "status": r.status, "version": r.version, "as_of_date": r.as_of_date.isoformat() if r.as_of_date else None,
        "three_lines": [x.get("text", "") for x in sm.get("three_lines") or []],
        "changes": [x.get("text", "") for x in sm.get("changes") or []],
        "stage": sm.get("stage"), "stage_note": (sm.get("stage_note") or {}).get("text"),
        "financials": c.get("financials"),
        "sections": [{"no": s.get("no"), "title": s.get("title")} for s in c.get("sections") or []],
    }
