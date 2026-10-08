"""기업 리포트 — 기업 원장·투자유치·기간 요약·기업DB 파일·공공데이터·검색 색인 (기획 8장, P2).

시간 규칙: DateTime 컬럼은 KST(naive).
"""
from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Optional

from sqlalchemy import (
    BigInteger, Boolean, Date, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.base import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def _company_fk(nullable: bool = False):
    return mapped_column(String(36), ForeignKey("portfolio_companies.id", ondelete="CASCADE"), nullable=nullable, index=True)


class CompanyFact(Base):
    """기업 사실 원장. 수정은 새 행 + supersedes_id로 이력 보존."""

    __tablename__ = "company_facts"
    __table_args__ = (Index("ix_company_facts_company_date", "company_id", "fact_date"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    company_id: Mapped[str] = _company_fk()
    fact_type: Mapped[str] = mapped_column(String(20), nullable=False)  # funding/contract/certification/product/people/financial/legal/award/other
    fact_date: Mapped[Optional[date]] = mapped_column(Date)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    detail: Mapped[Optional[dict]] = mapped_column(JSONB)
    source_refs: Mapped[Optional[list]] = mapped_column(JSONB)  # [{article_id, url, title, date}]
    status: Mapped[str] = mapped_column(String(12), default="candidate", nullable=False)  # candidate/confirmed/rejected/superseded
    origin: Mapped[str] = mapped_column(String(10), default="ai", nullable=False)  # ai/manual
    dedup_key: Mapped[Optional[str]] = mapped_column(String(64), index=True)
    confirmed_by: Mapped[Optional[str]] = mapped_column(String(36))
    confirmed_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    supersedes_id: Mapped[Optional[str]] = mapped_column(String(36))
    # 자동 검증 결과(원문 인용·주체 확인·독립 출처 수·검색 교차 확인·판정 이유). fact_verify.py
    verification: Mapped[Optional[dict]] = mapped_column(JSONB)
    verified_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)


class CompanyFundingRound(Base):
    """투자유치 기록(보고서 5번 항목·투자유치 차트의 원천)."""

    __tablename__ = "company_funding_rounds"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    company_id: Mapped[str] = _company_fk()
    round_date: Mapped[Optional[date]] = mapped_column(Date)
    round_name: Mapped[Optional[str]] = mapped_column(String(50))  # 시드/프리A/시리즈A/…/브릿지/정책자금
    amount: Mapped[Optional[int]] = mapped_column(BigInteger)  # 원 단위
    currency: Mapped[str] = mapped_column(String(3), default="KRW", nullable=False)
    amount_disclosed: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    investors: Mapped[Optional[list]] = mapped_column(JSONB)  # [{name, type, lead}]
    valuation: Mapped[Optional[int]] = mapped_column(BigInteger)
    is_follow_on: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    source_refs: Mapped[Optional[list]] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String(12), default="candidate", nullable=False)  # candidate/confirmed/rejected
    origin: Mapped[str] = mapped_column(String(10), default="ai", nullable=False)
    fact_id: Mapped[Optional[str]] = mapped_column(String(36))
    confirmed_by: Mapped[Optional[str]] = mapped_column(String(36))
    confirmed_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)


class CompanyPeriodSummary(Base):
    """온디맨드 기간 요약 캐시(기사 아카이브 [기간 요약])."""

    __tablename__ = "company_period_summaries"
    __table_args__ = (Index("ix_period_summary_lookup", "company_id", "date_from", "date_to"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    company_id: Mapped[str] = _company_fk()
    date_from: Mapped[date] = mapped_column(Date, nullable=False)
    date_to: Mapped[date] = mapped_column(Date, nullable=False)
    article_hash: Mapped[str] = mapped_column(String(64), nullable=False)  # 기사 목록이 바뀌면 다시 만든다
    content: Mapped[Optional[dict]] = mapped_column(JSONB)
    model: Mapped[Optional[str]] = mapped_column(String(80))
    created_by: Mapped[Optional[str]] = mapped_column(String(36))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)


class CompanyFile(Base):
    """기업DB의 모든 파일(자동 생성·업로드). company_id가 없으면 '_포트폴리오 공통'."""

    __tablename__ = "company_files"
    __table_args__ = (Index("ix_company_files_company_folder", "company_id", "folder"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    company_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("portfolio_companies.id", ondelete="CASCADE"), nullable=True, index=True
    )
    folder: Mapped[str] = mapped_column(String(12), nullable=False)  # info/news/docs/reports/images/portfolio
    display_name: Mapped[str] = mapped_column(String(300), nullable=False)
    original_name: Mapped[Optional[str]] = mapped_column(String(300))
    storage_key: Mapped[str] = mapped_column(String(300), nullable=False)
    file_type: Mapped[str] = mapped_column(String(10), nullable=False)  # pdf/docx/xlsx/md/png/…
    mime: Mapped[Optional[str]] = mapped_column(String(100))
    size: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    period_label: Mapped[Optional[str]] = mapped_column(String(20))  # 2026-10, 20261015, 2026H2
    doc_kind: Mapped[Optional[str]] = mapped_column(String(40))  # 기업카드/뉴스/자료/IR자료/…
    origin: Mapped[str] = mapped_column(String(10), default="upload", nullable=False)  # auto/upload
    auto_key: Mapped[Optional[str]] = mapped_column(String(120), index=True)  # 자동 파일 덮어쓰기용 키
    related_type: Mapped[Optional[str]] = mapped_column(String(20))
    related_id: Mapped[Optional[str]] = mapped_column(String(36))
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    status: Mapped[str] = mapped_column(String(12), default="active", nullable=False)  # active/draft/approved/sent/deleted
    memo: Mapped[Optional[str]] = mapped_column(Text)
    search_text: Mapped[Optional[str]] = mapped_column(Text)
    created_by: Mapped[Optional[str]] = mapped_column(String(36))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)


class CompanyFileDownload(Base):
    """다운로드 기록(보안: 누가 언제 내려받았나)."""

    __tablename__ = "company_file_downloads"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    file_id: Mapped[Optional[str]] = mapped_column(String(36), index=True)
    company_id: Mapped[Optional[str]] = mapped_column(String(36))
    kind: Mapped[str] = mapped_column(String(10), default="file", nullable=False)  # file/zip
    user_id: Mapped[Optional[str]] = mapped_column(String(36))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)


class CompanyPublicData(Base):
    """공공데이터 시점별 스냅샷(국민연금 가입자 수, 특허, 사업자 상태, 주가)."""

    __tablename__ = "company_public_data"
    __table_args__ = (UniqueConstraint("company_id", "source", "as_of", name="uq_public_data_snapshot"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    company_id: Mapped[str] = _company_fk()
    source: Mapped[str] = mapped_column(String(10), nullable=False)  # nps/kipris/nts/kis
    as_of: Mapped[date] = mapped_column(Date, nullable=False)
    data: Mapped[Optional[dict]] = mapped_column(JSONB)
    error: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)


class SearchIndex(Base):
    """통합 검색 색인(기획 7-4). title·body에 pg_trgm GIN 인덱스."""

    __tablename__ = "search_index"
    __table_args__ = (
        UniqueConstraint("entity_type", "entity_id", name="uq_search_entity"),
        Index("ix_search_company_date", "company_id", "doc_date"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    entity_type: Mapped[str] = mapped_column(String(20), nullable=False)  # company/article/fact/funding/daily/file/…
    entity_id: Mapped[str] = mapped_column(String(64), nullable=False)
    company_id: Mapped[Optional[str]] = mapped_column(String(36))
    title: Mapped[str] = mapped_column(Text, nullable=False)
    body: Mapped[Optional[str]] = mapped_column(Text)
    norm: Mapped[Optional[str]] = mapped_column(Text)  # 공백 제거·소문자(띄어쓰기 무시 검색용)
    doc_date: Mapped[Optional[date]] = mapped_column(Date)
    tags: Mapped[Optional[list]] = mapped_column(JSONB)
    url_path: Mapped[Optional[str]] = mapped_column(String(300))
    is_latest: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)


class CompanyMonthlyDigest(Base):
    """기업별 월간 요약(P3). 월간 브리핑의 기업별 정리이자 반기 보고서의 재료."""

    __tablename__ = "company_monthly_digests"
    __table_args__ = (UniqueConstraint("company_id", "month", name="uq_monthly_digest_company_month"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    company_id: Mapped[str] = _company_fk()
    month: Mapped[str] = mapped_column(String(7), nullable=False, index=True)  # YYYY-MM
    summary: Mapped[Optional[str]] = mapped_column(Text)  # 검토를 통과한 핵심 요약(2~3문장)
    content: Mapped[Optional[dict]] = mapped_column(JSONB)  # facts·meaning·client_explain·qa·caution·checkpoints
    key_fact_ids: Mapped[Optional[list]] = mapped_column(JSONB)
    article_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    positive_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    caution_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    model: Mapped[Optional[str]] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)


class MonthlyBriefing(Base):
    """월간 브리핑 1건(월별). status: generating/ready/held/sent/failed"""

    __tablename__ = "monthly_briefings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    month: Mapped[str] = mapped_column(String(7), unique=True, nullable=False)  # YYYY-MM
    status: Mapped[str] = mapped_column(String(12), default="generating", nullable=False)
    content: Mapped[Optional[dict]] = mapped_column(JSONB)  # summary·companies·cautions·checkpoints·sources
    stats: Mapped[Optional[dict]] = mapped_column(JSONB)    # 포트폴리오 동향(기업별 건수·전월 대비)·커버리지 점검
    review_summary: Mapped[Optional[dict]] = mapped_column(JSONB)
    hold_reason: Mapped[Optional[str]] = mapped_column(Text)
    approved_by: Mapped[Optional[str]] = mapped_column(String(36))
    approved_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)


class ShortLink(Base):
    """카톡 브리핑 본문에 넣는 짧은 기사 링크(/r/코드 → 원문). 로그인 없이 열린다(원문 주소로 보내기만 함)."""

    __tablename__ = "short_links"

    code: Mapped[str] = mapped_column(String(12), primary_key=True)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    url_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    article_id: Mapped[Optional[str]] = mapped_column(String(36), index=True)
    hits: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)


# --------------------------------------------------------------------------- 반기 기업 종합보고서 (기획 6장, P4)

class CompanyDocument(Base):
    """자료함: 기업DB 03_자료에 올린 문서를 읽은 결과(텍스트·이미지·AI 메모). 원본 파일은 company_files.

    extract_status: pending(읽는 중) / done / failed / unsupported(형식 미지원)
    doc_type: ir / financial / shareholders / investor_report / contract / press / product / certificate / other
    has_personal_investment: 고객 개인의 투자 금액·지분이 들어 있다고 AI가 본 문서 — 보고서에 그 내용은 쓰지 않는다
    """

    __tablename__ = "company_documents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    company_id: Mapped[str] = _company_fk()
    file_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("company_files.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    filename: Mapped[str] = mapped_column(String(300), nullable=False)
    file_type: Mapped[str] = mapped_column(String(10), nullable=False)
    size: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    page_count: Mapped[Optional[int]] = mapped_column(Integer)
    extract_status: Mapped[str] = mapped_column(String(12), default="pending", nullable=False)
    extract_method: Mapped[Optional[str]] = mapped_column(String(30))  # pypdf / claude_pdf / python-docx / hwp5 / …
    extract_error: Mapped[Optional[str]] = mapped_column(Text)
    extracted_text: Mapped[Optional[str]] = mapped_column(Text)
    extracted_images: Mapped[Optional[list]] = mapped_column(JSONB)  # [{key, ext, page, width, height, name}]
    doc_type: Mapped[Optional[str]] = mapped_column(String(20))
    ai_memo: Mapped[Optional[str]] = mapped_column(Text)
    ai_facts: Mapped[Optional[list]] = mapped_column(JSONB)  # 보고서에 쓸 만한 핵심 사실 몇 줄
    has_personal_investment: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    use_in_report: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_public: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)  # 부록에 링크를 걸어도 되는 공개 자료
    # 자료 날짜(2026-10-08): 문서가 어느 시점 자료인가. AI 가 본문에서 찾고 담당자가 고친다. 반기 보고서는
    # 이 날짜(없으면 올린 날)가 반기 끝 이전인 자료만 쓴다. source: ai / manual (없으면 못 찾음 → 확인 필요)
    doc_date: Mapped[Optional[date]] = mapped_column(Date)
    doc_date_source: Mapped[Optional[str]] = mapped_column(String(10))
    uploaded_by: Mapped[Optional[str]] = mapped_column(String(36))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)


class CompanyReport(Base):
    """반기 기업 종합보고서(또는 수시 보고서). 수정하면 새 버전.

    owner_user_id: NULL = 자동 생성본(그 기업을 추가한 모두가 본다), 값 = 그 사람이 고친 자기 버전.
    매니저 보고서는 대표 승인 없이 매니저가 검토·출력한다(2026-10-01 결정).
    status: generating / draft(검토 중) / final(검토 완료) / failed
    """

    __tablename__ = "company_reports"
    __table_args__ = (Index("ix_company_reports_period", "company_id", "period_year", "period_half"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    company_id: Mapped[str] = _company_fk()
    report_type: Mapped[str] = mapped_column(String(12), default="half_year", nullable=False)  # half_year/adhoc
    period_year: Mapped[int] = mapped_column(Integer, nullable=False)
    period_half: Mapped[int] = mapped_column(Integer, nullable=False)  # 1(상반기)/2(하반기)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    owner_user_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    base_report_id: Mapped[Optional[str]] = mapped_column(String(36))  # 어느 버전을 고쳐 만들었나
    # 공식본: 그 기업의 검토 담당이 [검토 완료]한 버전 — 그 기업을 추가한 모두가 보고, 검토 없이 고객에게 보낼 수 있다(2026-10-08)
    official: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    status: Mapped[str] = mapped_column(String(12), default="generating", nullable=False)
    progress_step: Mapped[Optional[str]] = mapped_column(String(40))
    progress: Mapped[int] = mapped_column(Integer, default=0, nullable=False)  # 0~100
    as_of_date: Mapped[Optional[date]] = mapped_column(Date)
    content: Mapped[Optional[dict]] = mapped_column(JSONB)      # 표지·한 장 요약·10개 항목·부록
    sources: Mapped[Optional[dict]] = mapped_column(JSONB)      # 출처 번호 → {title, url, date, kind}
    review: Mapped[Optional[dict]] = mapped_column(JSONB)       # 교차 검토 결과·합의 안 된 문장
    sales_note: Mapped[Optional[dict]] = mapped_column(JSONB)   # 영업 대화 노트(내부용)
    main_model: Mapped[Optional[str]] = mapped_column(String(60))
    review_model: Mapped[Optional[str]] = mapped_column(String(60))
    token_usage: Mapped[Optional[dict]] = mapped_column(JSONB)
    error: Mapped[Optional[str]] = mapped_column(Text)
    created_by: Mapped[Optional[str]] = mapped_column(String(36))
    finalized_by: Mapped[Optional[str]] = mapped_column(String(36))
    finalized_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)


class ReportImage(Base):
    """보고서 이미지 후보·선택(보고서당 선택 2~10개). 기사 사진은 쓰지 않는다."""

    __tablename__ = "report_images"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    report_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("company_reports.id", ondelete="CASCADE"), nullable=False, index=True
    )
    section_no: Mapped[Optional[int]] = mapped_column(Integer)  # 1~10
    kind: Mapped[str] = mapped_column(String(12), nullable=False)  # chart/document/homepage/press_kit
    storage_key: Mapped[str] = mapped_column(String(300), nullable=False)
    document_id: Mapped[Optional[str]] = mapped_column(String(36))
    caption: Mapped[Optional[str]] = mapped_column(String(300))
    source_label: Mapped[Optional[str]] = mapped_column(String(200))
    source_url: Mapped[Optional[str]] = mapped_column(String(500))
    rights_note: Mapped[Optional[str]] = mapped_column(String(200))
    width: Mapped[Optional[int]] = mapped_column(Integer)
    height: Mapped[Optional[int]] = mapped_column(Integer)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    selected: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)


class ReportExport(Base):
    """출력 기록: 보고서·버전·형식·내려받은 사람·시각(·어느 고객용)."""

    __tablename__ = "report_exports"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    report_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("company_reports.id", ondelete="SET NULL"), nullable=True, index=True
    )
    version: Mapped[Optional[int]] = mapped_column(Integer)
    format: Mapped[str] = mapped_column(String(6), nullable=False)  # pdf/docx/zip
    client_id: Mapped[Optional[str]] = mapped_column(String(36))   # 고객용으로 뽑은 경우
    file_id: Mapped[Optional[str]] = mapped_column(String(36))     # 기업DB 04_보고서에 저장된 파일
    exported_by: Mapped[Optional[str]] = mapped_column(String(36))
    exported_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
