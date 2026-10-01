"""반기 보고서 출력 — 인쇄용 PDF(A4, Dr.GM 브랜드, 링크 클릭)·DOCX (기획 6장, P4-7).

- 표지(기업명·대상 반기·기준일·Dr.GM, 고객용이면 'OOO 고객님께'), 한 장 요약, 10개 항목(그림 포함), 부록(링크)
- 쪽 아래: 담당자 이름·연락처(고객용이면 그 고객의 담당 매니저) · 쪽 번호
- 내부용 정보(영업 대화 노트·검토 의견·확인 필요 표시)는 넣지 않는다
- 출력하면 기업DB 04_보고서에 자동 저장하고 출력 기록(report_exports)을 남긴다
"""
from __future__ import annotations

import io
import logging
import re
from dataclasses import dataclass
from typing import Optional
from xml.sax.saxutils import escape

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.company_report import CompanyReport, ReportExport, ReportImage
from app.services.company_report import storage
from app.services.company_report.timeutil import now_kst

logger = logging.getLogger(__name__)

NAVY = "#1F2A44"
GOLD = "#B8975A"
INK = "#1F2937"
MUTED = "#6B7280"
BRAND = "Dr.GM Family Office"
STAGES = ["개발", "출시", "매출 발생", "흑자", "상장 준비", "상장"]


@dataclass
class ExportContext:
    report: CompanyReport
    images: list[ReportImage]           # 선택된 그림만
    client_name: Optional[str] = None   # 고객용이면 고객 이름
    contact_line: str = ""              # '담당 OOO · 010-… · email'


def _cite_nums(ids: list[str], sources: dict) -> list[int]:
    return [sources[i]["no"] for i in ids or [] if i in sources and sources[i].get("no")]


def _sent_text(s: dict, sources: dict, html: bool) -> str:
    nums = _cite_nums(s.get("source_ids") or [], sources)
    pre = "(분석) " if s.get("kind") == "analysis" else ""
    if html:
        sup = "".join(f'<super><font size="6.5" color="{MUTED}"><a href="#src{n}">[{n}]</a></font></super>' for n in nums)
        return f"{escape(pre)}{escape(s.get('text', ''))}{sup}"
    return f"{pre}{s.get('text', '')}" + "".join(f"[{n}]" for n in nums)


def _filename(report: CompanyReport, company: str, ext: str, client: Optional[str]) -> str:
    half = "상반기" if report.period_half == 1 else "하반기"
    base = f"{company}_반기보고서_{report.period_year}{half}_v{report.version}"
    if client:
        base += f"_{client}고객"
    return re.sub(r'[\\/:*?"<>|\s]+', "", base) + f".{ext}"


# --------------------------------------------------------------------------- PDF

def build_pdf(ctx: ExportContext) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import (
        CondPageBreak, Image, KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle,
    )

    from app.services.company_report.company_db import _pdf_fonts

    r = ctx.report
    c = r.content or {}
    sources = r.sources or {}
    cover = c.get("cover") or {}
    font, bold = _pdf_fonts()
    W, H = A4
    body_w = W - 40 * mm

    st = {
        "brand": ParagraphStyle("brand", fontName=bold, fontSize=11, textColor=colors.HexColor(GOLD), leading=14),
        "title": ParagraphStyle("title", fontName=bold, fontSize=26, leading=34, textColor=colors.HexColor(NAVY)),
        "sub": ParagraphStyle("sub", fontName=font, fontSize=13, leading=20, textColor=colors.HexColor(INK)),
        "h1": ParagraphStyle("h1", fontName=bold, fontSize=14, leading=20, textColor=colors.HexColor(NAVY), spaceBefore=6, spaceAfter=6),
        "h2": ParagraphStyle("h2", fontName=bold, fontSize=10.5, leading=15, textColor=colors.HexColor(NAVY), spaceBefore=6, spaceAfter=3),
        "p": ParagraphStyle("p", fontName=font, fontSize=10, leading=17, textColor=colors.HexColor(INK)),
        "li": ParagraphStyle("li", fontName=font, fontSize=10, leading=17, leftIndent=10, bulletIndent=0, textColor=colors.HexColor(INK)),
        "cell": ParagraphStyle("cell", fontName=font, fontSize=8.5, leading=12, textColor=colors.HexColor(INK)),
        "cellh": ParagraphStyle("cellh", fontName=bold, fontSize=8.5, leading=12, textColor=colors.white),
        "cap": ParagraphStyle("cap", fontName=font, fontSize=8, leading=11, textColor=colors.HexColor(MUTED), alignment=1),
        "small": ParagraphStyle("small", fontName=font, fontSize=8.5, leading=13, textColor=colors.HexColor(MUTED)),
    }

    def bullet(text: str):
        return Paragraph(text, st["li"], bulletText="•")

    def image_flow(im: ReportImage):
        try:
            data = storage.read_bytes(im.storage_key)
        except Exception:
            return None
        w, h = im.width or 1200, im.height or 700
        max_w, max_h = body_w * 0.92, 95 * mm  # 한 쪽에 그림 2개 이하가 되도록 높이 제한
        scale = min(max_w / w, max_h / h)
        img = Image(io.BytesIO(data), width=w * scale, height=h * scale)
        cap = escape(im.caption or "") + (f" · 출처: {escape(im.source_label)}" if im.source_label else "")
        return KeepTogether([Spacer(1, 2 * mm), img, Spacer(1, 1 * mm), Paragraph(cap, st["cap"]), Spacer(1, 3 * mm)])

    def table_flow(blk: dict):
        cols = blk.get("columns") or []
        data = [[Paragraph(escape(str(x)), st["cellh"]) for x in cols]]
        for row in blk.get("rows") or []:
            cells = list(row.get("cells") or []) + [""] * (len(cols) - len(row.get("cells") or []))
            nums = _cite_nums(row.get("source_ids") or [], sources)
            out = []
            for i, x in enumerate(cells[:len(cols)]):
                t = escape(str(x))
                if i == len(cols) - 1 and nums:
                    t += "".join(f'<super><font size="6" color="{MUTED}"><a href="#src{n}">[{n}]</a></font></super>' for n in nums)
                out.append(Paragraph(t, st["cell"]))
            data.append(out)
        if len(cols) == 2:
            widths = [38 * mm, body_w - 38 * mm]
        else:
            widths = None
        t = Table(data, colWidths=widths, repeatRows=1, hAlign="LEFT")
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor(NAVY)),
            ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#D1D5DB")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F7F5F0")]),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ]))
        notes = [row.get("note") for row in blk.get("rows") or [] if row.get("note")]
        return [t] + ([Paragraph(escape(" · ".join(notes)), st["small"])] if notes else []) + [Spacer(1, 3 * mm)]

    story = []
    # 표지
    story += [Spacer(1, 40 * mm), Paragraph(BRAND, st["brand"]), Spacer(1, 6 * mm),
              Paragraph(escape(cover.get("company") or ""), st["title"]),
              Paragraph(f"{escape(cover.get('period') or '')} 기업 종합보고서", st["sub"]), Spacer(1, 4 * mm),
              Paragraph(f"기준일 {escape(cover.get('as_of') or '')} · v{r.version}", st["small"])]
    if ctx.client_name:
        story += [Spacer(1, 30 * mm), Paragraph(f"{escape(ctx.client_name)} 고객님께 드리는 보고서입니다.", st["sub"])]
    if ctx.contact_line:
        story += [Spacer(1, 6 * mm), Paragraph(escape(ctx.contact_line), st["small"])]
    story.append(PageBreak())

    # 한 장 요약
    sm = c.get("summary") or {}
    story.append(Paragraph("한 장 요약", st["h1"]))
    for s in sm.get("three_lines") or []:
        story.append(bullet(_sent_text(s, sources, True)))
    if sm.get("changes"):
        story.append(Paragraph("지난 보고서 이후 달라진 점", st["h2"]))
        for s in sm["changes"]:
            story.append(bullet(_sent_text(s, sources, True)))
    if sm.get("stage") in STAGES:
        idx = STAGES.index(sm["stage"])
        cells = [[Paragraph(f'<font color="{"#FFFFFF" if i == idx else (NAVY if i < idx else "#9CA3AF")}">{s}</font>', st["cell"])
                  for i, s in enumerate(STAGES)]]
        t = Table(cells, colWidths=[body_w / len(STAGES)] * len(STAGES))
        t.setStyle(TableStyle([("BACKGROUND", (idx, 0), (idx, 0), colors.HexColor(NAVY)),
                               ("BOX", (0, 0), (-1, -1), 0.4, colors.HexColor("#D1D5DB")),
                               ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#D1D5DB")),
                               ("ALIGN", (0, 0), (-1, -1), "CENTER")]))
        story += [Paragraph("회사가 지금 있는 단계", st["h2"]), t]
        if sm.get("stage_note"):
            story += [Spacer(1, 2 * mm), Paragraph(_sent_text(sm["stage_note"], sources, True), st["p"])]
    story.append(PageBreak())

    # 본문
    by_sec: dict[int, list[ReportImage]] = {}
    for im in ctx.images:
        by_sec.setdefault(im.section_no or 0, []).append(im)
    for sec in c.get("sections") or []:
        flows = [Paragraph(f"{sec['no']}. {escape(sec['title'])}", st["h1"])]
        if not sec.get("blocks") and not by_sec.get(sec["no"]):
            flows.append(Paragraph("공개 자료 없음", st["small"]))
        for blk in sec.get("blocks") or []:
            if blk["type"] == "para":
                flows.append(Paragraph(" ".join(_sent_text(s, sources, True) for s in blk["items"]), st["p"]))
                flows.append(Spacer(1, 2 * mm))
            elif blk["type"] == "timeline":
                for s in blk["items"]:
                    flows.append(bullet(f"<b>{escape(s.get('date') or '')}</b>  {_sent_text(s, sources, True)}"))
                flows.append(Spacer(1, 2 * mm))
            elif blk["type"] == "table":
                flows += table_flow(blk)
        story.append(CondPageBreak(45 * mm))
        story += flows
        for im in by_sec.get(sec["no"], []):
            f = image_flow(im)
            if f:
                story.append(f)
        story.append(Spacer(1, 4 * mm))

    # 부록
    ap = c.get("appendix") or {}
    story += [PageBreak(), Paragraph("부록", st["h1"]), Paragraph("1. 출처 목록", st["h2"])]
    for x in ap.get("citations") or []:
        t = escape(x.get("title") or "")
        if x.get("url"):
            t = f'<link href="{escape(x["url"])}" color="#1D4ED8">{t}</link>'
        meta = " · ".join(escape(str(v)) for v in (x.get("press"), x.get("date")) if v)
        story.append(Paragraph(f'<a name="src{x["no"]}"/>[{x["no"]}] {t} <font color="{MUTED}">{meta}</font>', st["small"]))

    def link_list(title, rows, fmt):
        if rows:
            story.append(Paragraph(title, st["h2"]))
            for row in rows:
                story.append(Paragraph(fmt(row), st["small"]))

    def lk(row):
        t = escape(row.get("title") or "")
        return f'<link href="{escape(row["url"])}" color="#1D4ED8">{t}</link>' if row.get("url") else t

    link_list("2. 이번 반기 주요 기사", ap.get("articles"), lambda a: f"{escape(a.get('date') or '')} {lk(a)} <font color='{MUTED}'>{escape(a.get('press') or '')}</font>")
    link_list("3. DART 공시 목록", ap.get("dart"), lambda a: f"{escape(a.get('date') or '')} {lk(a)}")
    fund = [f for f in ap.get("funding_sources") or [] if f.get("links")]
    link_list("4. 투자유치 출처", fund, lambda f: f"{escape(f.get('round') or '')} {escape(f.get('date') or '')}: " + ", ".join(lk(x) for x in f["links"]))
    link_list("5. 참고 자료 목록", ap.get("documents"), lambda d: f"{escape(d['name'])} <font color='{MUTED}'>{'공개 자료' if d.get('is_public') else '회사 제공 자료(비공개)'}</font>")
    link_list("6. 용어 풀이", ap.get("glossary"), lambda g: f"<b>{escape(g['term'])}</b>: {escape(g.get('desc') or '')}")
    v = ap.get("verification") or {}
    story += [Paragraph("7. 검증 요약", st["h2"]),
              Paragraph(f"문장 {v.get('total', '-')}개 · 출처 {v.get('source_count', '-')}개 · 교차 검토(Gemini → Claude) 후 삭제 "
                        f"{v.get('removed', 0)}개 · 기준일 {escape(str(v.get('as_of') or ''))}", st["small"]),
              Paragraph("8. 면책 문구", st["h2"]), Paragraph(escape(ap.get("disclaimer") or ""), st["small"])]

    footer = f"{BRAND} · {cover.get('company', '')} {cover.get('period', '')} 보고서" + (f" · {ctx.contact_line}" if ctx.contact_line else "")

    def on_page(canvas, doc):
        canvas.saveState()
        canvas.setStrokeColor(colors.HexColor(GOLD))
        canvas.setLineWidth(1.2)
        canvas.line(20 * mm, H - 14 * mm, W - 20 * mm, H - 14 * mm)
        canvas.setFont(font, 7.5)
        canvas.setFillColor(colors.HexColor(MUTED))
        canvas.drawString(20 * mm, 10 * mm, footer[:120])
        canvas.drawRightString(W - 20 * mm, 10 * mm, f"{doc.page}")
        canvas.restoreState()

    def on_first(canvas, doc):
        canvas.saveState()
        canvas.setFillColor(colors.HexColor(NAVY))
        canvas.rect(0, H - 22 * mm, W, 22 * mm, stroke=0, fill=1)
        canvas.setFillColor(colors.HexColor(GOLD))
        canvas.rect(0, H - 23.5 * mm, W, 1.5 * mm, stroke=0, fill=1)
        canvas.restoreState()

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm, topMargin=20 * mm, bottomMargin=18 * mm,
                            title=f"{cover.get('company', '')} {cover.get('period', '')} 기업 종합보고서", author=BRAND)
    doc.build(story, onFirstPage=on_first, onLaterPages=on_page)
    return buf.getvalue()


# --------------------------------------------------------------------------- DOCX

def _add_hyperlink(paragraph, url: str, text: str):
    from docx.opc.constants import RELATIONSHIP_TYPE as RT
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn

    r_id = paragraph.part.relate_to(url, RT.HYPERLINK, is_external=True)
    h = OxmlElement("w:hyperlink")
    h.set(qn("r:id"), r_id)
    run = OxmlElement("w:r")
    rpr = OxmlElement("w:rPr")
    color = OxmlElement("w:color")
    color.set(qn("w:val"), "1D4ED8")
    u = OxmlElement("w:u")
    u.set(qn("w:val"), "single")
    rpr.append(color)
    rpr.append(u)
    run.append(rpr)
    t = OxmlElement("w:t")
    t.text = text
    t.set(qn("xml:space"), "preserve")
    run.append(t)
    h.append(run)
    paragraph._p.append(h)


def build_docx(ctx: ExportContext) -> bytes:
    import docx
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.oxml.ns import qn
    from docx.shared import Mm, Pt, RGBColor

    r = ctx.report
    c = r.content or {}
    sources = r.sources or {}
    cover = c.get("cover") or {}
    d = docx.Document()
    sec0 = d.sections[0]
    sec0.page_width, sec0.page_height = Mm(210), Mm(297)
    for m in ("left_margin", "right_margin"):
        setattr(sec0, m, Mm(20))
    sec0.top_margin, sec0.bottom_margin = Mm(20), Mm(18)
    normal = d.styles["Normal"]
    normal.font.name = "맑은 고딕"
    normal.element.rPr.rFonts.set(qn("w:eastAsia"), "맑은 고딕")
    normal.font.size = Pt(10)
    navy = RGBColor(0x1F, 0x2A, 0x44)
    gold = RGBColor(0xB8, 0x97, 0x5A)

    def heading(text, size=14, color=navy):
        p = d.add_paragraph()
        run = p.add_run(text)
        run.bold, run.font.size, run.font.color.rgb = True, Pt(size), color
        return p

    def sent_par(s, prefix=""):
        p = d.add_paragraph(style="List Bullet" if prefix == "•" else None)
        p.add_run(_sent_text(s, sources, False))
        return p

    # 표지
    for _ in range(6):
        d.add_paragraph()
    heading(BRAND, 11, gold)
    heading(cover.get("company") or "", 26)
    heading(f"{cover.get('period', '')} 기업 종합보고서", 14, RGBColor(0x1F, 0x29, 0x37))
    d.add_paragraph(f"기준일 {cover.get('as_of', '')} · v{r.version}")
    if ctx.client_name:
        d.add_paragraph()
        d.add_paragraph(f"{ctx.client_name} 고객님께 드리는 보고서입니다.")
    if ctx.contact_line:
        d.add_paragraph(ctx.contact_line)
    d.add_page_break()

    sm = c.get("summary") or {}
    heading("한 장 요약")
    for s in sm.get("three_lines") or []:
        sent_par(s, "•")
    if sm.get("changes"):
        heading("지난 보고서 이후 달라진 점", 11)
        for s in sm["changes"]:
            sent_par(s, "•")
    if sm.get("stage") in STAGES:
        heading("회사가 지금 있는 단계", 11)
        p = d.add_paragraph()
        for i, s in enumerate(STAGES):
            run = p.add_run(f" {s} ")
            run.bold = s == sm["stage"]
            if s == sm["stage"]:
                run.font.color.rgb = gold
            if i < len(STAGES) - 1:
                p.add_run("→")
        if sm.get("stage_note"):
            sent_par(sm["stage_note"])
    d.add_page_break()

    by_sec: dict[int, list[ReportImage]] = {}
    for im in ctx.images:
        by_sec.setdefault(im.section_no or 0, []).append(im)
    for sec in c.get("sections") or []:
        heading(f"{sec['no']}. {sec['title']}")
        if not sec.get("blocks") and not by_sec.get(sec["no"]):
            d.add_paragraph("공개 자료 없음")
        for blk in sec.get("blocks") or []:
            if blk["type"] == "para":
                d.add_paragraph(" ".join(_sent_text(s, sources, False) for s in blk["items"]))
            elif blk["type"] == "timeline":
                for s in blk["items"]:
                    p = d.add_paragraph(style="List Bullet")
                    p.add_run(f"{s.get('date', '')} ").bold = True
                    p.add_run(_sent_text(s, sources, False))
            elif blk["type"] == "table":
                cols = blk.get("columns") or []
                t = d.add_table(rows=1, cols=len(cols))
                t.style = "Table Grid"
                for i, col in enumerate(cols):
                    cell = t.rows[0].cells[i]
                    cell.text = str(col)
                    for run in cell.paragraphs[0].runs:
                        run.bold = True
                for row in blk.get("rows") or []:
                    cells = t.add_row().cells
                    vals = list(row.get("cells") or []) + [""] * len(cols)
                    nums = "".join(f"[{n}]" for n in _cite_nums(row.get("source_ids") or [], sources))
                    for i in range(len(cols)):
                        cells[i].text = str(vals[i]) + (nums if i == len(cols) - 1 else "")
                d.add_paragraph()
        for im in by_sec.get(sec["no"], []):
            try:
                data = storage.read_bytes(im.storage_key)
            except Exception:
                continue
            w, h = im.width or 1200, im.height or 700
            width_mm = min(165, 95 * w / h)
            d.add_picture(io.BytesIO(data), width=Mm(width_mm))
            d.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
            cap = d.add_paragraph(f"{im.caption or ''}" + (f" · 출처: {im.source_label}" if im.source_label else ""))
            cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
            for run in cap.runs:
                run.font.size, run.font.color.rgb = Pt(8), RGBColor(0x6B, 0x72, 0x80)

    ap = c.get("appendix") or {}
    d.add_page_break()
    heading("부록")
    heading("1. 출처 목록", 11)
    for x in ap.get("citations") or []:
        p = d.add_paragraph(f"[{x['no']}] ")
        if x.get("url"):
            _add_hyperlink(p, x["url"], x.get("title") or x["url"])
        else:
            p.add_run(x.get("title") or "")
        meta = " · ".join(str(v) for v in (x.get("press"), x.get("date")) if v)
        if meta:
            p.add_run(f"  {meta}")

    def links(title, rows, render):
        if rows:
            heading(title, 11)
            for row in rows:
                render(d.add_paragraph(), row)

    def art(p, a):
        p.add_run(f"{a.get('date') or ''} ")
        if a.get("url"):
            _add_hyperlink(p, a["url"], a.get("title") or a["url"])
        else:
            p.add_run(a.get("title") or "")
        if a.get("press"):
            p.add_run(f"  {a['press']}")

    links("2. 이번 반기 주요 기사", ap.get("articles"), art)
    links("3. DART 공시 목록", ap.get("dart"), art)
    links("5. 참고 자료 목록", ap.get("documents"),
          lambda p, x: p.add_run(f"{x['name']} ({'공개 자료' if x.get('is_public') else '회사 제공 자료(비공개)'})"))
    links("6. 용어 풀이", ap.get("glossary"), lambda p, g: p.add_run(f"{g['term']}: {g.get('desc') or ''}"))
    v = ap.get("verification") or {}
    heading("7. 검증 요약", 11)
    d.add_paragraph(f"문장 {v.get('total', '-')}개 · 출처 {v.get('source_count', '-')}개 · 교차 검토(Gemini → Claude) 후 삭제 "
                    f"{v.get('removed', 0)}개 · 기준일 {v.get('as_of') or ''}")
    heading("8. 면책 문구", 11)
    d.add_paragraph(ap.get("disclaimer") or "")

    footer = sec0.footer.paragraphs[0]
    footer.text = f"{BRAND} · {cover.get('company', '')} {cover.get('period', '')} 보고서" + (f" · {ctx.contact_line}" if ctx.contact_line else "")
    for run in footer.runs:
        run.font.size, run.font.color.rgb = Pt(7.5), RGBColor(0x6B, 0x72, 0x80)
    buf = io.BytesIO()
    d.save(buf)
    return buf.getvalue()


# --------------------------------------------------------------------------- 출력 + 저장 + 기록

async def contact_for(db: AsyncSession, user_id: Optional[str]) -> str:
    from app.models.user import User

    if not user_id:
        return ""
    u = await db.get(User, user_id)
    if not u:
        return ""
    return " · ".join(x for x in [f"담당 {u.nickname}", u.phone or "", u.email or ""] if x)


async def export(db: AsyncSession, report: CompanyReport, fmt: str, *, user_id: Optional[str],
                 client_id: Optional[str] = None, record: bool = True) -> tuple[bytes, str, str]:
    """(파일 바이트, 파일 이름, mime). 고객용이면 표지에 고객 이름, 쪽 아래에 그 고객 담당 매니저 연락처."""
    from sqlalchemy import select

    from app.models.client import Client
    from app.models.news_briefing import PortfolioCompany
    from app.services.company_report import company_db

    if fmt not in ("pdf", "docx"):
        raise ValueError("형식은 pdf 또는 docx 입니다.")
    if report.status not in ("draft", "final") or not report.content:
        raise ValueError("아직 완성되지 않은 보고서는 출력할 수 없습니다.")
    images = list((await db.execute(select(ReportImage).where(ReportImage.report_id == report.id, ReportImage.selected == True)  # noqa: E712
                                    .order_by(ReportImage.sort_order))).scalars().all())
    client_name, contact_uid = None, user_id
    if client_id:
        cl = await db.get(Client, client_id)
        if cl:
            client_name, contact_uid = cl.name, cl.user_id or user_id
    ctx = ExportContext(report=report, images=images, client_name=client_name, contact_line=await contact_for(db, contact_uid))
    data = build_pdf(ctx) if fmt == "pdf" else build_docx(ctx)
    company = await db.get(PortfolioCompany, report.company_id)
    name = _filename(report, company.name if company else "기업", fmt, client_name)
    if record:
        # 기업DB 04_보고서는 그 기업을 추가한 모든 매니저가 본다. 그래서 공용 자동 생성본만 저장하고,
        # 고객용(고객 이름이 들어감)·개인 수정본은 기록만 남긴다(개인 버전은 보고서 화면에서 본인·대표가 다시 뽑는다).
        file_id = None
        if not client_id and not report.owner_user_id:
            period = f"{report.period_year}H{report.period_half}"
            f = await company_db.save_auto(
                db, company_id=report.company_id, folder="reports", doc_kind="반기보고서",
                period_label=f"{period}_v{report.version}", ext=fmt, data=data,
                auto_key=f"report:{report.id}:{fmt}", related_type="report", related_id=report.id, search_text=None,
            )
            file_id = f.id
        db.add(ReportExport(report_id=report.id, version=report.version, format=fmt, client_id=client_id, file_id=file_id,
                            exported_by=user_id, exported_at=now_kst()))
        await db.commit()
    mime = "application/pdf" if fmt == "pdf" else "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    return data, name, mime
