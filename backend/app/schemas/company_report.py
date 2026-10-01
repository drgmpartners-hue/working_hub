"""기업 리포트 요청·응답 스키마."""
from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, Field


class CandidateSearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=100)


class KeywordSet(BaseModel):
    required: list[str] = []
    boost: list[str] = []
    exclude: list[str] = []


class KeywordSuggestRequest(BaseModel):
    name: str
    name_en: Optional[str] = None
    ceo_name: Optional[str] = None
    industry: Optional[str] = None


class PreviewRequest(KeywordSet):
    days: int = Field(default=7, ge=1, le=30)


class CompanyBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    name_en: Optional[str] = None
    aliases: Optional[list[str]] = None
    is_listed: bool = False
    stock_code: Optional[str] = None
    corp_code: Optional[str] = None
    biz_reg_no: Optional[str] = None
    ceo_name: Optional[str] = None
    industry: Optional[str] = None
    address: Optional[str] = None
    homepage: Optional[str] = None
    established_at: Optional[date] = None
    profile_source: str = "manual"
    search_query: Optional[str] = None
    invested_at: Optional[date] = None
    invest_type: Optional[str] = None
    invest_amount: Optional[int] = None
    owner_user_id: Optional[str] = None
    memo: Optional[str] = None


class CompanyCreate(CompanyBase):
    keywords: KeywordSet = KeywordSet()
    backfill_months: int = Field(default=6, ge=0, le=12)


class CompanyUpdate(BaseModel):
    name: Optional[str] = None
    name_en: Optional[str] = None
    aliases: Optional[list[str]] = None
    is_listed: Optional[bool] = None
    stock_code: Optional[str] = None
    corp_code: Optional[str] = None
    biz_reg_no: Optional[str] = None
    ceo_name: Optional[str] = None
    industry: Optional[str] = None
    address: Optional[str] = None
    homepage: Optional[str] = None
    established_at: Optional[date] = None
    invested_at: Optional[date] = None
    invest_type: Optional[str] = None
    invest_amount: Optional[int] = None
    owner_user_id: Optional[str] = None
    memo: Optional[str] = None
    is_active: Optional[bool] = None
    keywords: Optional[KeywordSet] = None
    # (예전) 담당 바꾸기 — 2026-10-01부터 쓰지 않음(무시)
    manager_user_id: Optional[str] = None


class CompanyOut(CompanyBase):
    id: str
    is_active: bool
    last_collected_at: Optional[datetime] = None
    deleted_at: Optional[datetime] = None
    created_at: datetime
    keywords: KeywordSet = KeywordSet()
    stats: dict = {}
    # 담당자별 (2026-10-01): 기업을 추가한 계정 — 대표·관리자에게만 채운다(매니저에겐 다른 사람이 안 보이게)
    added_by: list[dict] = []              # [{id, name, role}]
    is_mine: bool = False                  # 요청한 사람(또는 보고 있는 매니저)의 목록에 있는지
    can_edit: bool = False                 # 정보·키워드·수집을 고칠 수 있는지
    can_manage: bool = False               # 비활성·삭제·복구(대표·관리자)
    deleted_reason: Optional[str] = None   # all_removed(담당자 모두 뺌) / admin(대표·관리자 삭제)
    deleted_by_name: Optional[str] = None  # 마지막으로 뺀 사람 또는 삭제한 사람
    # (예전 필드 — 화면 호환용)
    scope: str = "manager"
    manager_user_id: Optional[str] = None
    manager_name: Optional[str] = None
    is_hidden: bool = False

    model_config = {"from_attributes": True}
