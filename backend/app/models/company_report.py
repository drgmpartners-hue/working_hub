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
