"""기업 리포트 담당자별 분리 (docs/login_logic P9).

규칙 (결정 D-7)
- 회사 공통 기업  : portfolio_companies.manager_user_id IS NULL. 대표가 등록. 모든 매니저에게 보인다.
- 매니저 추가 기업: manager_user_id = 그 매니저. 그 매니저와 대표만 본다.
- 매니저는 회사 공통 기업을 자기 화면에서 '숨기기'만 할 수 있다(company_hidden). 고치기·삭제는 대표만.
- 브리핑은 하루 한 번 전사로 만들고, 볼 때·보낼 때 '보는 사람이 볼 수 있는 기업' 카드만 남긴다.
- 수신자 명단도 담당자별(briefing_recipients.manager_user_id, NULL = 회사·대표 명단).

'보는 관점(View)'
- 매니저(대행 중 포함) : 언제나 자기 관점. 헤더는 무시한다.
- 대표                 : X-View-As 헤더로 고른다. 없음/'all' = 전체(모든 담당자 기업을 담당 표시와 함께, 결정 D-3),
                         'company' = 회사 공통만, 매니저 id = 그 매니저 화면 그대로.
  수신자 명단은 '전체'·'회사 공통'일 때 회사(대표) 명단을 쓴다.
"""
from __future__ import annotations

import copy
from dataclasses import dataclass
from types import SimpleNamespace
from typing import Any, Optional

from fastapi import Depends, HTTPException, Request
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import permissions
from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.news_briefing import CompanyHidden, PortfolioCompany

VIEW_AS_HEADER = "X-View-As"
COMPANY = "company"
ALL = "all"


@dataclass
class View:
    """누구 관점으로 기업 목록을 보는가.

    mode: 'company'(회사 공통·대표 명단) / 'manager'(manager_id 의 화면) / 'all'(대표 전용 전체)
    """

    user: Any                       # 실제 권한 주체(대행 중이면 매니저)
    mode: str = COMPANY
    manager_id: Optional[str] = None
    manager_name: Optional[str] = None

    @property
    def is_owner(self) -> bool:
        return self.user is not None and permissions.is_owner(self.user)

    @property
    def list_owner(self) -> Optional[str]:
        """수신자 명단·숨김의 주인. 회사 관점이면 None."""
        return self.manager_id if self.mode == "manager" else None

    def as_dict(self) -> dict:
        return {"mode": self.mode, "manager_id": self.manager_id, "manager_name": self.manager_name}


def manager_view(user, manager_id: str, name: Optional[str] = None) -> View:
    return View(user=user, mode="manager", manager_id=manager_id, manager_name=name)


async def resolve_view(db: AsyncSession, user, raw: Optional[str]) -> View:
    if not permissions.is_owner(user):
        return manager_view(user, user.id, getattr(user, "nickname", None))
    raw = (raw or "").strip()
    if not raw or raw == ALL:
        return View(user=user, mode=ALL)
    if raw == COMPANY or raw == user.id:
        return View(user=user, mode=COMPANY)
    from app.models.user import User

    m = await db.get(User, raw)
    if not m or m.role != permissions.MANAGER:
        raise HTTPException(404, "담당자를 찾을 수 없습니다.")
    return manager_view(user, m.id, m.nickname)


async def get_view(request: Request, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> View:
    """FastAPI 의존성: 요청한 사람 + (대표면) 고른 담당자."""
    return await resolve_view(db, user, request.headers.get(VIEW_AS_HEADER) or request.query_params.get("view_as"))


async def list_view(db: AsyncSession, list_owner: Optional[str]) -> View:
    """수신자 명단 주인 기준 관점(발송·폰 링크용). None = 회사 명단 → 회사 공통 기업."""
    if not list_owner:
        return View(user=None, mode=COMPANY)
    from app.models.user import User

    m = await db.get(User, list_owner)
    return manager_view(m, list_owner, getattr(m, "nickname", None))


# --------------------------------------------------------------------------- 기업 가시성

def hidden_subquery(user_id: str):
    return select(CompanyHidden.company_id).where(CompanyHidden.user_id == user_id)


def visible_clause(view: View):
    """PortfolioCompany 에 거는 조건. 전체 보기면 None."""
    if view.mode == ALL:
        return None
    if view.mode == COMPANY:
        return PortfolioCompany.manager_user_id.is_(None)
    mid = view.manager_id
    return or_(
        and_(PortfolioCompany.manager_user_id.is_(None), PortfolioCompany.id.not_in(hidden_subquery(mid))),
        PortfolioCompany.manager_user_id == mid,
    )


def scope_companies(stmt, view: View):
    cond = visible_clause(view)
    return stmt if cond is None else stmt.where(cond)


async def visible_company_ids(db: AsyncSession, view: View) -> Optional[set[str]]:
    """볼 수 있는 기업 id. 전체 보기면 None(거르지 않음). 삭제·비활성 여부는 따지지 않는다(지난 브리핑에도 쓰므로)."""
    if view.mode == ALL:
        return None
    rows = (await db.execute(scope_companies(select(PortfolioCompany.id), view))).scalars().all()
    return set(rows)


async def hidden_ids(db: AsyncSession, view: View) -> set[str]:
    if view.mode != "manager":
        return set()
    return set((await db.execute(hidden_subquery(view.manager_id))).scalars().all())


async def can_manage_all(db: AsyncSession, user) -> bool:
    """회사 공통 기업까지 고칠 수 있는 사람: 대표 또는 기업 리포트 관리자."""
    if permissions.is_owner(user):
        return True
    from app.services.company_report import admin

    return await admin.is_admin(db, user)


async def can_edit(db: AsyncSession, user, c: PortfolioCompany) -> bool:
    if c.manager_user_id and c.manager_user_id == user.id:
        return True
    return await can_manage_all(db, user)


def can_read(user, c: PortfolioCompany) -> bool:
    """상세·하위 자료 읽기. 숨긴 공통 기업도 직접 열면 볼 수 있다(목록·브리핑에서만 빠짐)."""
    if permissions.is_owner(user):
        return True
    return c.manager_user_id is None or c.manager_user_id == user.id


async def assert_company(db: AsyncSession, user, company_id: str, write: bool = False) -> PortfolioCompany:
    c = await db.get(PortfolioCompany, company_id)
    if not c or not can_read(user, c):
        raise HTTPException(404, "기업을 찾을 수 없습니다.")
    if write and not await can_edit(db, user, c):
        raise HTTPException(
            403, "회사 공통 기업은 대표만 고칠 수 있습니다. 내 화면에서 빼려면 기업 목록의 [숨기기]를 쓰세요."
        )
    return c


async def assert_company_ids(db: AsyncSession, user, company_ids: list[str], write: bool = False) -> None:
    for cid in company_ids:
        await assert_company(db, user, cid, write=write)


def readable_clause(user):
    """사람 기준 읽기 범위(숨김 무시). 검색·기업DB처럼 '상세로 들어갈 수 있는 것' 기준."""
    if permissions.is_owner(user):
        return None
    return or_(PortfolioCompany.manager_user_id.is_(None), PortfolioCompany.manager_user_id == user.id)


async def readable_company_ids(db: AsyncSession, user) -> Optional[set[str]]:
    cond = readable_clause(user)
    if cond is None:
        return None
    return set((await db.execute(select(PortfolioCompany.id).where(cond))).scalars().all())


# --------------------------------------------------------------------------- 브리핑 거르기

def filter_daily(b, ids: Optional[set[str]]):
    """데일리 브리핑을 볼 수 있는 기업 카드만 남긴 사본(원본은 건드리지 않음). ids=None 이면 원본 그대로."""
    if ids is None or b is None:
        return b
    from app.services.company_report.daily import build_sources

    cards_all = b.company_summaries or []
    rs = dict(b.review_summary or {})
    smap = rs.get("source_map")
    if smap is None and cards_all and all(isinstance(c.get("articles"), list) for c in cards_all):
        try:  # 예전 브리핑: 걸러낸 뒤 다시 계산하면 번호가 어긋나므로 원본 기준으로 고정
            smap = build_sources(cards_all)[1]
        except (KeyError, TypeError):
            smap = {}
    smap = smap or {}
    cards = [c for c in cards_all if c.get("company_id") in ids]
    keep_articles = {a.get("id") for c in cards for a in c.get("articles") or []}
    overall = rs.get("overall") or [
        {"text": t, "source_ids": []} for t in (b.overall_summary or "").split("\n") if t.strip()
    ]
    kept = []
    for s in overall:
        sids = s.get("source_ids") or []
        arts = [smap.get(x) for x in sids if x in smap]
        if not arts or any(a in keep_articles for a in arts):
            kept.append({**s, "source_ids": [x for x in sids if smap.get(x) in keep_articles or x not in smap]})
    n_art = sum(int(c.get("article_count") or len(c.get("articles") or [])) for c in cards)
    n_cau = sum(int(c.get("caution_count") or 0) for c in cards)
    if not [s for s in kept if s.get("source_ids")]:
        # 종합 문장이 전부 다른 기업 이야기였으면 담당 기업 기준 한 줄로 대신한다
        kept = [{"text": (f"담당 기업 {len(cards)}곳에서 새 기사 {n_art}건(주의 {n_cau}건)이 있었습니다."
                          if cards else "담당 기업 관련 새 기사가 없습니다."), "source_ids": []}]
    rs["overall"] = kept
    rs["source_map"] = smap
    info = dict(b.basic_info or {})
    info["company_with_news"] = len(cards)
    view = SimpleNamespace(**{k: getattr(b, k) for k in (
        "id", "briefing_date", "status", "is_fallback", "approved_by", "approved_at", "sent_at", "created_at",
    )})
    view.basic_info = info
    view.company_summaries = cards
    view.review_summary = rs
    view.overall_summary = "\n".join(s["text"] for s in kept)
    view.article_count = n_art
    view.caution_count = n_cau
    return view


def filter_monthly(mb, ids: Optional[set[str]]):
    """월간 브리핑 사본: 기업 구역·주의·주목·체크포인트를 볼 수 있는 기업만, 전체 요약은 그 기업 출처가 있는 문장만."""
    if ids is None or mb is None:
        return mb
    c = copy.deepcopy(mb.content or {})
    src = c.get("sources") or {}

    def ok(x) -> bool:
        return isinstance(x, dict) and x.get("company_id") in ids

    c["companies"] = [x for x in c.get("companies") or [] if ok(x)]
    c["cautions"] = [x for x in c.get("cautions") or [] if ok(x)]
    c["highlights"] = [x for x in c.get("highlights") or [] if ok(x)]
    c["checkpoints"] = [x for x in c.get("checkpoints") or [] if ok(x)]
    summary = []
    for s in c.get("summary") or []:
        sids = s.get("source_ids") or []
        if not sids or any((src.get(x) or {}).get("company_id") in ids for x in sids):
            summary.append(s)
    c["summary"] = summary
    st = dict(mb.stats or {})
    st["article_count"] = sum(int(x.get("article_count") or 0) for x in c["companies"])
    st["caution_count"] = sum(int(x.get("caution_count") or 0) for x in c["companies"])
    st["company_with_news"] = sum(1 for x in c["companies"] if x.get("article_count"))
    st["company_total"] = len(c["companies"])
    rows = [r for r in st.get("companies") or [] if r.get("company_id") in ids]
    if "companies" in st:
        st["companies"] = rows
    view = SimpleNamespace(**{k: getattr(mb, k, None) for k in (
        "id", "month", "status", "hold_reason", "approved_by", "approved_at", "sent_at", "created_at", "updated_at",
        "review_summary", "is_fallback",
    )})
    view.content = c
    view.stats = st
    return view
