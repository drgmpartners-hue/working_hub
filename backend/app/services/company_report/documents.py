"""자료함 — 기업DB 03_자료에 올린 문서를 읽어 보고서 재료로 만든다 (기획 6장, P4-2).

흐름: 업로드(company_files) → register() 로 company_documents 'pending' → process() 가
  ① 파서로 텍스트·이미지 추출(doc_parser) ② 스캔본 PDF 는 Claude 가 직접 읽기 ③ 그림 저장
  ④ AI 문서 메모(종류·요약·핵심 사실·고객 개인 투자 정보 포함 여부) ⑤ 검색 색인 갱신.
- 업로드 직후 웹 서비스 백그라운드에서 돌고, 놓친 것은 file_worker 가 30분마다 다시 처리한다.
- 고객 개인이 당사를 통해 투자한 금액·지분은 보고서에 쓰지 않는다(결정 27). 그런 내용이 보이면
  has_personal_investment 로 표시하고, 보고서 작성 때 그 부분을 빼라고 지시한다.
"""
from __future__ import annotations

import logging
import uuid
from datetime import timedelta
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.company_report import CompanyDocument, CompanyFile
from app.services.company_report import doc_parser, storage

logger = logging.getLogger(__name__)

DOC_TYPES = {
    "ir": "IR 자료", "financial": "재무제표·감사보고서", "shareholders": "주주명부·지분", "investor_report": "투자사 보고서",
    "contract": "계약서", "press": "보도자료", "product": "제품·서비스 소개", "certificate": "인증·특허·수상", "other": "기타",
}
READABLE = doc_parser.SUPPORTED | set(doc_parser.LEGACY_HINT)
MEMO_INPUT_CHARS = 24_000
OCR_MAX_BYTES = 30 * 1024 * 1024
OCR_MAX_PAGES = 100

MEMO_SYSTEM = (
    "너는 투자기업 자료를 정리하는 애널리스트다. 고객용 반기 보고서에 쓸 재료를 고른다. "
    "문서에 없는 내용을 지어내지 마라. 숫자·날짜·이름은 문서 표기 그대로 옮긴다."
)
MEMO_PROMPT = """아래는 '{company}'에 관한 자료 '{filename}'에서 뽑은 글이다.

다음 JSON 으로 답하라:
{{
  "doc_type": "ir|financial|shareholders|investor_report|contract|press|product|certificate|other 중 하나",
  "memo": "이 문서가 무엇이고 보고서 어디에 쓸 만한지 3줄 이내(한국어, 각 줄 60자 안팎)",
  "facts": ["보고서에 쓸 만한 핵심 사실 최대 8개. 한 줄에 하나, 숫자·날짜 포함, 문서 표기 그대로"],
  "has_personal_investment": true 또는 false,
  "is_public": true 또는 false
}}

- has_personal_investment: 특정 개인(고객) 이름과 그 사람의 투자 금액·주식 수·지분율이 함께 나오면 true.
  그 개인 정보는 facts 에 절대 넣지 마라. 회사·펀드·VC 의 투자 정보는 괜찮다.
- is_public: 보도자료·홈페이지 자료처럼 공개된 문서로 보이면 true, 내부 자료·계약서·주주명부면 false.

--- 자료 글(앞부분) ---
{text}
"""
OCR_PROMPT = (
    "이 PDF 의 글을 빠짐없이 옮겨 적어라. 쪽마다 '[N쪽]' 으로 시작하고, 표는 칸을 ' | ' 로 나눠 한 줄씩 적어라. "
    "설명이나 요약은 붙이지 말고 원문 글만 적어라."
)


async def register(db: AsyncSession, f: CompanyFile, user_id: Optional[str]) -> Optional[CompanyDocument]:
    """03_자료에 올라온 파일이면 자료함 항목을 만든다(이미 있으면 그대로). 커밋은 호출한 쪽."""
    if not f.company_id or f.folder != "docs" or f.status == "deleted" or (f.file_type or "").lower() not in READABLE:
        return None
    doc = (await db.execute(select(CompanyDocument).where(CompanyDocument.file_id == f.id))).scalar_one_or_none()
    if doc:
        return doc
    doc = CompanyDocument(company_id=f.company_id, file_id=f.id, filename=f.original_name or f.display_name,
                          file_type=(f.file_type or "").lower(), size=f.size or 0, extract_status="pending",
                          uploaded_by=user_id or f.created_by)
    db.add(doc)
    await db.flush()
    return doc


def _save_images(company_id: str, images: list[doc_parser.ParsedImage]) -> list[dict]:
    out = []
    for im in images:
        key = storage.make_key(company_id, "docimg", str(uuid.uuid4()), im.ext)
        try:
            storage.save_bytes(key, im.data)
        except Exception as e:
            logger.info("자료 그림 저장 실패: %s", e)
            continue
        out.append({"key": key, "ext": im.ext, "page": im.page, "width": im.width, "height": im.height, "name": im.name})
    return out


async def _ai_key(db: AsyncSession) -> Optional[str]:
    from app.services.company_report.keys import get_service_key

    k = await get_service_key(db, "claude")
    return k[0] if k else None


async def _ocr_pdf(db: AsyncSession, data: bytes, pages: Optional[int]) -> Optional[str]:
    key = await _ai_key(db)
    if not key or len(data) > OCR_MAX_BYTES or (pages or 0) > OCR_MAX_PAGES:
        return None
    from app.services import llm_client
    from app.services.company_report import config

    models = await config.get_models(db)
    r = await llm_client.claude_pdf_text(key, data, OCR_PROMPT, model=models["writer"], stage="doc_ocr")
    return r.text.strip() or None


async def _memo(db: AsyncSession, company_name: str, filename: str, text: str) -> Optional[dict]:
    key = await _ai_key(db)
    if not key or not text.strip():
        return None
    from app.services import llm_client
    from app.services.company_report import config

    models = await config.get_models(db)
    prompt = MEMO_PROMPT.format(company=company_name, filename=filename, text=text[:MEMO_INPUT_CHARS])
    r = await llm_client.claude_json(key, prompt, system=MEMO_SYSTEM, model=models["summary"], max_tokens=1500,
                                     stage="doc_memo")
    return r.data if isinstance(r.data, dict) else None


async def process(db: AsyncSession, doc_id: str, *, with_ai: bool = True) -> CompanyDocument:
    """자료 한 건 읽기(다시 읽기 포함). 실패해도 예외를 밖으로 내지 않고 상태에 남긴다."""
    from app.models.news_briefing import PortfolioCompany
    from app.services.company_report import search

    doc = await db.get(CompanyDocument, doc_id)
    if doc is None:
        raise ValueError("자료를 찾을 수 없습니다.")
    f = await db.get(CompanyFile, doc.file_id)
    company = await db.get(PortfolioCompany, doc.company_id)
    if f is None or f.status == "deleted":
        doc.extract_status, doc.extract_error = "failed", "원본 파일이 삭제되었습니다."
        await db.commit()
        return doc
    try:
        data = storage.read_bytes(f.storage_key)
    except Exception:
        doc.extract_status, doc.extract_error = "failed", "원본 파일을 저장소에서 찾지 못했습니다."
        await db.commit()
        return doc

    r = doc_parser.parse(doc.file_type, data)
    text, method = r.text, r.method
    if r.needs_ocr and doc.file_type == "pdf":
        try:
            ocr = await _ocr_pdf(db, data, r.page_count)
            if ocr:
                text, method = doc_parser._clean(ocr), "claude_pdf"
        except Exception as e:
            logger.info("PDF AI 읽기 실패(%s): %s", doc.filename, e)
        if not text.strip() and r.status == "done":
            r.status, r.error = "failed", "스캔본 PDF 라 글자를 읽지 못했습니다(Claude 키가 있으면 AI 로 다시 읽습니다)."
    # 예전에 저장한 그림은 바꾼다
    for old in doc.extracted_images or []:
        try:
            storage.path_of(old["key"]).unlink(missing_ok=True)
        except Exception:
            pass
    doc.extracted_images = _save_images(doc.company_id, r.images) if r.images else []
    doc.extracted_text = text or None
    doc.page_count = r.page_count
    doc.extract_method = method or None
    doc.extract_status = r.status
    doc.extract_error = r.error
    doc.size = f.size or doc.size

    if with_ai and r.status == "done" and text.strip():
        try:
            m = await _memo(db, company.name if company else "", doc.filename, text)
        except Exception as e:
            logger.info("자료 메모 실패(%s): %s", doc.filename, e)
            m = None
        if m:
            dt = str(m.get("doc_type") or "other")
            doc.doc_type = dt if dt in DOC_TYPES else "other"
            doc.ai_memo = str(m.get("memo") or "")[:1500] or None
            facts = m.get("facts") if isinstance(m.get("facts"), list) else []
            doc.ai_facts = [str(x)[:300] for x in facts[:8] if str(x).strip()]
            doc.has_personal_investment = bool(m.get("has_personal_investment"))
            doc.is_public = bool(m.get("is_public"))
            if doc.doc_type and f.doc_kind in (None, "자료"):
                f.doc_kind = DOC_TYPES[doc.doc_type][:40]
    # 검색 색인: PDF·HWP 본문까지 찾히게
    if text:
        f.search_text = text[:20000]
        await search.index_file(db, f, company.name if company else None)
    from app.services.company_report import usage

    await usage.flush(db)
    await db.commit()
    await db.refresh(doc)
    return doc


async def process_in_background(doc_id: str) -> None:
    from app.db.session import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        try:
            await process(db, doc_id)
        except Exception as e:
            logger.warning("자료 읽기 실패(%s): %s", doc_id, e)


async def sync_company(db: AsyncSession, company_id: str) -> list[str]:
    """03_자료에 있는데 자료함에 없는 파일을 등록한다(예전에 올린 파일). 새로 만든 id 목록."""
    files = (await db.execute(select(CompanyFile).where(
        CompanyFile.company_id == company_id, CompanyFile.folder == "docs", CompanyFile.status != "deleted"))).scalars().all()
    have = set((await db.execute(select(CompanyDocument.file_id).where(CompanyDocument.company_id == company_id))).scalars().all())
    new_ids = []
    for f in files:
        if f.id not in have:
            d = await register(db, f, f.created_by)
            if d:
                new_ids.append(d.id)
    return new_ids


async def process_pending(db: AsyncSession, limit: int = 20) -> int:
    """file_worker 용: 5분 넘게 'pending' 인 자료(재시작 등으로 놓친 것)를 처리한다."""
    from sqlalchemy import func

    cutoff = func.now() - timedelta(minutes=5)  # updated_at 은 DB 시계(server_default/onupdate)
    ids = (await db.execute(select(CompanyDocument.id).where(
        CompanyDocument.extract_status == "pending", CompanyDocument.updated_at < cutoff).limit(limit))).scalars().all()
    for i in ids:
        try:
            await process(db, i)
        except Exception as e:
            await db.rollback()
            logger.warning("자료 읽기 실패(%s): %s", i, e)
    return len(ids)


def doc_out(d: CompanyDocument, file: Optional[CompanyFile] = None) -> dict:
    return {
        "id": d.id, "company_id": d.company_id, "file_id": d.file_id, "filename": d.filename, "file_type": d.file_type,
        "size": d.size, "page_count": d.page_count, "extract_status": d.extract_status, "extract_method": d.extract_method,
        "extract_error": d.extract_error, "text_chars": len(d.extracted_text or ""),
        "image_count": len(d.extracted_images or []), "doc_type": d.doc_type,
        "doc_type_label": DOC_TYPES.get(d.doc_type or "", None), "ai_memo": d.ai_memo, "ai_facts": d.ai_facts or [],
        "has_personal_investment": d.has_personal_investment, "use_in_report": d.use_in_report, "is_public": d.is_public,
        "display_name": file.display_name if file else None,
        "created_at": d.created_at.isoformat() if d.created_at else None,
        "updated_at": d.updated_at.isoformat() if d.updated_at else None,
    }
