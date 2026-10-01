"""기업 리포트 — 투자기업·뉴스·데일리 브리핑·발송·AI 검토·과거 데이터 구축 모델.

기획서 8장 / tasks_news_report.md P1-B.
시간 규칙: DateTime 컬럼은 KST(naive)로 저장한다(기존 테이블과 동일하게 timezone 없음).
"""
from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Optional

from sqlalchemy import (
    BigInteger, Boolean, Date, DateTime, Float, ForeignKey, Index, Integer, String, Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.base import Base


def _uuid() -> str:
    return str(uuid.uuid4())


class PortfolioCompany(Base):
    """투자기업 — 모든 데이터의 출발점."""

    __tablename__ = "portfolio_companies"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    name_en: Mapped[Optional[str]] = mapped_column(String(200))
    aliases: Mapped[Optional[list]] = mapped_column(JSONB)  # 이전 사명·약칭
    is_listed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    stock_code: Mapped[Optional[str]] = mapped_column(String(12))
    corp_code: Mapped[Optional[str]] = mapped_column(String(8))
    biz_reg_no: Mapped[Optional[str]] = mapped_column(String(12))
    ceo_name: Mapped[Optional[str]] = mapped_column(String(100))
    industry: Mapped[Optional[str]] = mapped_column(String(200))
    address: Mapped[Optional[str]] = mapped_column(String(300))
    homepage: Mapped[Optional[str]] = mapped_column(String(300))
    established_at: Mapped[Optional[date]] = mapped_column(Date)
    profile_source: Mapped[str] = mapped_column(String(20), default="manual", nullable=False)  # dart/web/manual
    search_query: Mapped[Optional[str]] = mapped_column(String(200))
    # 내부 정보(선택)
    invested_at: Mapped[Optional[date]] = mapped_column(Date)
    invest_type: Mapped[Optional[str]] = mapped_column(String(50))
    invest_amount: Mapped[Optional[int]] = mapped_column(BigInteger)
    owner_user_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # (예전, P9) NULL = 회사 공통, 값 = 매니저가 추가. 2026-10-01부터 누가 보는지는 company_members 가 정한다(기록용으로 남김)
    manager_user_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    memo: Mapped[Optional[str]] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_collected_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    # 1단계 삭제(화면에서 삭제): 목록·검색·수집에서 빠지고 데이터·폴더는 남는다. 2단계(완전 삭제) 전까지 복구 가능
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, index=True)
    deleted_by: Mapped[Optional[str]] = mapped_column(String(36))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )


class CompanyMember(Base):
    """이 기업을 자기 목록에 추가한 계정(2026-10-01). 같은 기업을 여러 명이 추가해도 기업·기사는 하나.

    매니저는 자기가 추가한 기업만 보고, 대표는 전부(누가 추가했는지와 함께) 본다.
    """

    __tablename__ = "company_members"
    __table_args__ = (UniqueConstraint("company_id", "user_id", name="uq_company_member"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    company_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("portfolio_companies.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)


class CompanyHidden(Base):
    """매니저가 회사 공통 기업을 자기 화면(브리핑·문자 포함)에서 숨김. 대표만 공통 기업을 고칠 수 있다."""

    __tablename__ = "company_hidden"
    __table_args__ = (UniqueConstraint("user_id", "company_id", name="uq_company_hidden_user_company"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    company_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("portfolio_companies.id", ondelete="CASCADE"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)


class CompanyKeyword(Base):
    """필수어(required)·보조어(boost)·제외어(exclude)."""

    __tablename__ = "company_keywords"
    __table_args__ = (UniqueConstraint("company_id", "keyword", "kind", name="uq_company_keyword"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    company_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("portfolio_companies.id", ondelete="CASCADE"), nullable=False, index=True
    )
    keyword: Mapped[str] = mapped_column(String(100), nullable=False)
    kind: Mapped[str] = mapped_column(String(10), nullable=False)  # required/boost/exclude
    source: Mapped[str] = mapped_column(String(10), default="manual", nullable=False)  # manual/ai/feedback
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)


class NewsArticle(Base):
    """기업별 기사·공시 아카이브(누적, 삭제하지 않음)."""

    __tablename__ = "news_articles"
    __table_args__ = (
        UniqueConstraint("company_id", "url_hash", name="uq_news_article_url"),
        Index("ix_news_articles_company_published", "company_id", "published_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    company_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("portfolio_companies.id", ondelete="CASCADE"), nullable=False
    )
    source_type: Mapped[str] = mapped_column(String(10), default="news", nullable=False)  # news/dart/manual
    source: Mapped[str] = mapped_column(String(20), default="naver", nullable=False)  # naver/google_rss/web/homepage/dart/manual
    collected_via: Mapped[str] = mapped_column(String(10), default="daily", nullable=False)  # daily/backfill/manual
    url: Mapped[str] = mapped_column(Text, nullable=False)
    url_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    press: Mapped[Optional[str]] = mapped_column(String(100))
    published_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    collected_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    relevance_score: Mapped[Optional[int]] = mapped_column(Integer)
    is_hidden: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    hidden_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    hidden_by: Mapped[Optional[str]] = mapped_column(String(36))
    dup_group_id: Mapped[Optional[str]] = mapped_column(String(36), index=True)
    is_representative: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    summary: Mapped[Optional[str]] = mapped_column(Text)
    tag: Mapped[Optional[str]] = mapped_column(String(10))  # positive/neutral/caution
    issue_type: Mapped[Optional[str]] = mapped_column(String(30))
    summarized_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    facts_extracted_at: Mapped[Optional[datetime]] = mapped_column(DateTime)  # 사실 후보 추출 완료(P2)


class NewsBriefing(Base):
    """데일리 브리핑 1건(날짜별)."""

    __tablename__ = "news_briefings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    briefing_date: Mapped[date] = mapped_column(Date, unique=True, nullable=False)
    status: Mapped[str] = mapped_column(String(12), default="draft", nullable=False)  # draft/approved/sent/failed/skipped
    basic_info: Mapped[Optional[dict]] = mapped_column(JSONB)  # 날씨·전일 증시·건수
    overall_summary: Mapped[Optional[str]] = mapped_column(Text)
    company_summaries: Mapped[Optional[list]] = mapped_column(JSONB)
    article_ids: Mapped[Optional[list]] = mapped_column(JSONB)
    article_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    caution_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_fallback: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)  # 교차 검토 미완료 → 단순 브리핑
    review_summary: Mapped[Optional[dict]] = mapped_column(JSONB)
    approved_by: Mapped[Optional[str]] = mapped_column(String(36))
    approved_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )


class BriefingRecipient(Base):
    """브리핑 수신자. 데일리·월간 공통. 명단은 담당자별(manager_user_id: NULL = 회사·대표 명단).

    받는 사람에게는 명단 주인이 볼 수 있는 기업 카드만 간다.

    직원 계정(user_id) 또는 데이터 관리 > 고객 정보 관리(client_id)에서 이름으로 찾아 추가한다.
    휴대폰 번호는 발송할 때마다 원본(계정·고객 정보)에서 다시 읽는다.
    """

    __tablename__ = "briefing_recipients"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=True
    )
    client_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("clients.id", ondelete="CASCADE"), nullable=True
    )
    manager_user_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    name: Mapped[Optional[str]] = mapped_column(String(100))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)


class BriefingSendLog(Base):
    __tablename__ = "briefing_send_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    briefing_type: Mapped[str] = mapped_column(String(10), default="daily", nullable=False)  # daily/monthly/test
    briefing_id: Mapped[Optional[str]] = mapped_column(String(36), index=True)
    user_id: Mapped[Optional[str]] = mapped_column(String(36))
    phone: Mapped[str] = mapped_column(String(20), nullable=False)
    recipient_name: Mapped[Optional[str]] = mapped_column(String(100))  # 받은 사람 이름(발송 당시)
    channel: Mapped[str] = mapped_column(String(10), default="alimtalk", nullable=False)  # alimtalk/lms
    status: Mapped[str] = mapped_column(String(12), nullable=False)  # requested/failed
    solapi_group_id: Mapped[Optional[str]] = mapped_column(String(100))
    error: Mapped[Optional[str]] = mapped_column(Text)
    sent_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)


class AIReviewLog(Base):
    """교차 검토 기록(작성 → Gemini 1차 → Claude 2차)."""

    __tablename__ = "ai_review_logs"
    __table_args__ = (Index("ix_ai_review_target", "target_type", "target_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    target_type: Mapped[str] = mapped_column(String(20), nullable=False)  # daily/monthly/report
    target_id: Mapped[Optional[str]] = mapped_column(String(36))
    stage: Mapped[str] = mapped_column(String(10), nullable=False)  # draft/review1/review2
    model: Mapped[str] = mapped_column(String(80), nullable=False)
    input_hash: Mapped[Optional[str]] = mapped_column(String(64))
    output: Mapped[Optional[dict]] = mapped_column(JSONB)
    verdict_summary: Mapped[Optional[dict]] = mapped_column(JSONB)
    tokens: Mapped[Optional[dict]] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)


class BackfillJob(Base):
    """과거 데이터 구축(백필)과 검증 결과(기획 7-5)."""

    __tablename__ = "backfill_jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    company_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("portfolio_companies.id", ondelete="CASCADE"), nullable=False, index=True
    )
    period_from: Mapped[date] = mapped_column(Date, nullable=False)
    period_to: Mapped[date] = mapped_column(Date, nullable=False)
    trigger: Mapped[str] = mapped_column(String(20), default="register", nullable=False)
    status: Mapped[str] = mapped_column(String(12), default="queued", nullable=False)  # queued/running/done/failed
    progress: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    source_stats: Mapped[Optional[dict]] = mapped_column(JSONB)
    coverage: Mapped[Optional[dict]] = mapped_column(JSONB)
    key_events: Mapped[Optional[dict]] = mapped_column(JSONB)
    sample_review: Mapped[Optional[dict]] = mapped_column(JSONB)
    estimated_recall: Mapped[Optional[float]] = mapped_column(Float)
    verdict: Mapped[Optional[str]] = mapped_column(String(15))  # sufficient/needs_more/insufficient
    report_file_id: Mapped[Optional[str]] = mapped_column(String(36))
    error: Mapped[Optional[str]] = mapped_column(Text)
    created_by: Mapped[Optional[str]] = mapped_column(String(36))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
