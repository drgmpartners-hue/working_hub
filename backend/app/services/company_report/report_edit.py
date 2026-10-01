"""반기 보고서 편집 — 내 버전·문장 고치기·그림 고르기·검토 완료 (기획 6장, P4-9).

규칙(2026-10-01 결정: 매니저는 대표 승인 없이 독립적으로 검토·출력)
- 자동 생성본(owner_user_id 없음)은 그 기업을 추가한 모두가 같이 본다. 누가 고치면 그 사람의 '내 버전'이 새로 생긴다.
- 내 버전이 '검토 중'이면 그 자리에서 고친다. '검토 완료'된 버전을 다시 고치면 새 버전(v+1)이 생긴다.
- [검토 완료]: 확인 필요(노란 표시) 문장이 남아 있어도 막지는 않고 개수를 알려 준다(화면에서 확인 창).
- 그림은 2~10개를 고른다(10개 넘게는 못 고름, 2개 미만이면 안내).
"""
from __future__ import annotations

import copy
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.company_report import CompanyReport, ReportImage
from app.services.company_report.timeutil import now_kst

MAX_SELECTED = 10
MIN_SELECTED = 2


async def own_copy(db: AsyncSession, r: CompanyReport, user_id: str) -> CompanyReport:
    """고칠 수 있는 내 버전을 돌려준다(없으면 복사해 만든다). 커밋은 하지 않는다."""
    if r.status not in ("draft", "final") or not r.content:
        raise HTTPException(409, "아직 완성되지 않은 보고서는 고칠 수 없습니다.")
    if r.owner_user_id == user_id and r.status == "draft":
        return r
    ver = (await db.execute(select(func.max(CompanyReport.version)).where(
        CompanyReport.company_id == r.company_id, CompanyReport.period_year == r.period_year,
        CompanyReport.period_half == r.period_half, CompanyReport.owner_user_id == user_id))).scalar() or 0
    new = CompanyReport(
        company_id=r.company_id, report_type=r.report_type, period_year=r.period_year, period_half=r.period_half,
        version=ver + 1, owner_user_id=user_id, base_report_id=r.id, status="draft", progress=100, progress_step="완료",
        as_of_date=r.as_of_date, content=copy.deepcopy(r.content), sources=copy.deepcopy(r.sources),
        review=copy.deepcopy(r.review), sales_note=copy.deepcopy(r.sales_note), main_model=r.main_model,
        review_model=r.review_model, created_by=user_id,
    )
    db.add(new)
    await db.flush()
    for im in (await db.execute(select(ReportImage).where(ReportImage.report_id == r.id))).scalars().all():
        db.add(ReportImage(report_id=new.id, section_no=im.section_no, kind=im.kind, storage_key=im.storage_key,
                           document_id=im.document_id, caption=im.caption, source_label=im.source_label,
                           source_url=im.source_url, rights_note=im.rights_note, width=im.width, height=im.height,
                           sort_order=im.sort_order, selected=im.selected))
    await db.flush()
    return new


def _walk(content: dict):
    """(아이템, 컨테이너 리스트, 종류) — 문장·타임라인·표 행 모두."""
    sm = content.get("summary") or {}
    for key in ("three_lines", "changes"):
        for x in sm.get(key) or []:
            yield x, sm[key], "sent"
    if sm.get("stage_note"):
        yield sm["stage_note"], None, "stage_note"
    for sec in content.get("sections") or []:
        for blk in sec.get("blocks") or []:
            if blk["type"] in ("para", "timeline"):
                for x in blk["items"]:
                    yield x, blk["items"], blk["type"]
            elif blk["type"] == "table":
                for x in blk["rows"]:
                    yield x, blk["rows"], "row"


def find_item(content: dict, item_id: str):
    for x, holder, kind in _walk(content):
        if x.get("id") == item_id:
            return x, holder, kind
    return None, None, None


def disputed_count(content: dict) -> int:
    return sum(1 for x, _, _ in _walk(content or {}) if x.get("disputed"))


def edit_item(content: dict, item_id: str, *, text: Optional[str] = None, cells: Optional[list[str]] = None,
              delete: bool = False, resolve: bool = False) -> dict:
    """문장·행 하나 고치기. 고친 문장은 '담당자 수정' 표시가 붙고 확인 필요 표시는 풀린다."""
    x, holder, kind = find_item(content, item_id)
    if x is None:
        raise HTTPException(404, "문장을 찾을 수 없습니다.")
    if delete:
        if kind == "stage_note":
            content["summary"]["stage_note"] = None
        else:
            holder.remove(x)
        # 빈 블록 정리
        for sec in content.get("sections") or []:
            sec["blocks"] = [b for b in sec.get("blocks") or [] if (b.get("items") if b["type"] != "table" else b.get("rows"))]
        return content
    if text is not None:
        if kind == "row":
            raise HTTPException(422, "표 행은 칸(cells)으로 고칩니다.")
        t = text.strip()
        if not t:
            raise HTTPException(422, "빈 문장으로 바꿀 수 없습니다. 지우려면 [삭제]를 쓰세요.")
        x["text"] = t[:600]
        x["edited"] = True
        x.pop("disputed", None)
    if cells is not None:
        if kind != "row":
            raise HTTPException(422, "칸(cells)은 표 행에만 씁니다.")
        x["cells"] = [str(c)[:300] for c in cells][:len(x.get("cells") or cells)]
        x["edited"] = True
        x.pop("disputed", None)
    if resolve:
        x.pop("disputed", None)
        x["resolved"] = True
    return content


async def set_image(db: AsyncSession, report: CompanyReport, image_id: str, *, selected: Optional[bool] = None,
                    caption: Optional[str] = None, section_no: Optional[int] = None, sort_order: Optional[int] = None) -> ReportImage:
    im = await db.get(ReportImage, image_id)
    if im is None or im.report_id != report.id:
        raise HTTPException(404, "그림을 찾을 수 없습니다.")
    if selected is True and not im.selected:
        n = (await db.execute(select(func.count()).select_from(ReportImage).where(
            ReportImage.report_id == report.id, ReportImage.selected == True))).scalar_one()  # noqa: E712
        if n >= MAX_SELECTED:
            raise HTTPException(422, f"그림은 {MAX_SELECTED}개까지 넣을 수 있습니다. 다른 그림을 먼저 빼세요.")
    if selected is not None:
        im.selected = selected
    if caption is not None:
        im.caption = caption.strip()[:300]
    if section_no is not None:
        if section_no not in range(1, 11):
            raise HTTPException(422, "항목 번호는 1~10입니다.")
        im.section_no = section_no
    if sort_order is not None:
        im.sort_order = sort_order
    return im


async def copy_image_id(db: AsyncSession, src_image_id: str, copy_report: CompanyReport) -> str:
    """원본 보고서의 그림 id → 내 버전에서 같은 그림 id(복사할 때 storage_key·순서가 같다)."""
    src = await db.get(ReportImage, src_image_id)
    if src is None:
        raise HTTPException(404, "그림을 찾을 수 없습니다.")
    if src.report_id == copy_report.id:
        return src.id
    m = (await db.execute(select(ReportImage).where(
        ReportImage.report_id == copy_report.id, ReportImage.storage_key == src.storage_key,
        ReportImage.sort_order == src.sort_order))).scalars().first()
    if m is None:
        raise HTTPException(404, "그림을 찾을 수 없습니다.")
    return m.id


async def finalize(db: AsyncSession, r: CompanyReport, user_id: str) -> tuple[CompanyReport, dict]:
    mine = await own_copy(db, r, user_id)
    n_sel = (await db.execute(select(func.count()).select_from(ReportImage).where(
        ReportImage.report_id == mine.id, ReportImage.selected == True))).scalar_one()  # noqa: E712
    mine.status, mine.finalized_by, mine.finalized_at = "final", user_id, now_kst()
    warnings = {"disputed": disputed_count(mine.content), "images": n_sel,
                "image_warning": None if MIN_SELECTED <= n_sel <= MAX_SELECTED else f"그림은 {MIN_SELECTED}~{MAX_SELECTED}개가 좋습니다(지금 {n_sel}개)."}
    return mine, warnings
