"""기업 리포트 API — /api/v1/company-report (기획 10장)."""
from __future__ import annotations

import logging

from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, select
from sqlalchemy.orm import aliased
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.db.session import AsyncSessionLocal, get_db
from app.models.news_briefing import (
    BackfillJob, BriefingRecipient, BriefingSendLog, CompanyKeyword, NewsArticle, NewsBriefing, PortfolioCompany,
)
from app.schemas.company_report import (
    CandidateSearchRequest, CompanyCreate, CompanyOut, CompanyUpdate, KeywordSet,
    KeywordSuggestRequest, PreviewRequest,
)
from app.services.company_report import company_finder, cron_status, search
from app.services.company_report import visibility as vis
from app.services.company_report.visibility import View, assert_company, get_view
from app.services.company_report.timeutil import now_kst, today_kst

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/company-report", tags=["company-report"])


async def require_admin(db: AsyncSession, user) -> None:
    from app.services.company_report import admin

    if not await admin.is_admin(db, user):
        raise HTTPException(403, "기업 리포트 관리자만 할 수 있습니다. 발송 설정 화면에서 관리자를 지정하세요.")


# --------------------------------------------------------------------------- 후보·키워드·미리보기

@router.post("/companies/search-candidates")
async def search_candidates(body: CandidateSearchRequest, current_user=Depends(get_current_user),
                            db: AsyncSession = Depends(get_db)):
    return await company_finder.search_candidates(db, body.query, current_user.id)


@router.post("/companies/keyword-suggest", response_model=dict)
async def keyword_suggest(body: KeywordSuggestRequest, current_user=Depends(get_current_user),
                          db: AsyncSession = Depends(get_db)):
    return await company_finder.suggest_keywords(db, body.model_dump(), current_user.id)


@router.post("/companies/preview-search")
async def preview_search(body: PreviewRequest, current_user=Depends(get_current_user),
                         db: AsyncSession = Depends(get_db)):
    if not body.required:
        raise HTTPException(400, "필수어가 1개 이상 필요합니다.")
    return await company_finder.preview_search(db, body.required, body.boost, body.exclude, body.days)


# --------------------------------------------------------------------------- CRUD

async def _keywords(db: AsyncSession, company_id: str) -> KeywordSet:
    rows = (await db.execute(select(CompanyKeyword).where(CompanyKeyword.company_id == company_id))).scalars().all()
    ks = KeywordSet()
    for r in rows:
        getattr(ks, r.kind if r.kind in ("required", "boost", "exclude") else "boost").append(r.keyword)
    return ks


async def _replace_keywords(db: AsyncSession, company_id: str, ks: KeywordSet, source: str = "manual") -> None:
    existing = (await db.execute(select(CompanyKeyword).where(CompanyKeyword.company_id == company_id))).scalars().all()
    for r in existing:
        await db.delete(r)
    await db.flush()
    for kind in ("required", "boost", "exclude"):
        seen = set()
        for kw in getattr(ks, kind):
            kw = kw.strip()
            if kw and kw not in seen:
                seen.add(kw)
                db.add(CompanyKeyword(company_id=company_id, keyword=kw[:100], kind=kind, source=source))


def _out(c: PortfolioCompany, ks: KeywordSet, stats: Optional[dict] = None, *, added_by: Optional[list] = None,
         is_mine: bool = False, can_edit: bool = False, can_manage: bool = False) -> CompanyOut:
    from app.services.company_report.ksic import industry_label

    skip = ("keywords", "stats", "scope", "manager_name", "manager_user_id", "is_hidden", "can_edit", "can_manage",
            "added_by", "is_mine")
    data = {k: getattr(c, k) for k in CompanyOut.model_fields if hasattr(c, k) and k not in skip}
    data["industry"] = industry_label(data.get("industry"))  # 이미 저장된 DART 숫자 업종코드도 이름으로 보여준다
    return CompanyOut(**data, keywords=ks, stats=stats or {}, added_by=added_by or [], is_mine=is_mine,
                      can_edit=can_edit, can_manage=can_manage)


async def _out_one(db: AsyncSession, c: PortfolioCompany, user, stats: Optional[dict] = None, view: Optional[View] = None) -> CompanyOut:
    manage_all = await vis.can_manage_all(db, user)
    mine_uid = view.member_id if view else user.id
    added = (await vis.member_names(db, [c.id])).get(c.id, []) if manage_all else []
    return _out(c, await _keywords(db, c.id), stats, added_by=added,
                is_mine=await vis.is_member(db, mine_uid, c.id),
                can_edit=manage_all or await vis.is_member(db, user.id, c.id), can_manage=manage_all)


@router.get("/companies", response_model=list[CompanyOut])
async def list_companies(active: Optional[bool] = None, q: Optional[str] = None, deleted: bool = False,
                         view: View = Depends(get_view), db: AsyncSession = Depends(get_db)):
    """deleted=true 이면 '삭제된 기업'(1단계 삭제) 목록만 — 대표·관리자만 본다.
    매니저는 자기가 추가한 기업, 대표는 전체(또는 [담당자 선택]한 목록). 2026-10-01 개편."""
    current_user = view.user
    manage_all = await vis.can_manage_all(db, current_user)
    if deleted and not manage_all:
        return []
    stmt = select(PortfolioCompany).where(
        PortfolioCompany.deleted_at.is_not(None) if deleted else PortfolioCompany.deleted_at.is_(None))
    if not deleted:
        stmt = vis.scope_companies(stmt, view)
    if active is not None:
        stmt = stmt.where(PortfolioCompany.is_active == active)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(PortfolioCompany.name.ilike(like) | PortfolioCompany.name_en.ilike(like))
    companies = (await db.execute(stmt.order_by(PortfolioCompany.name))).scalars().all()
    if not companies:
        return []

    now = now_kst()
    today0 = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week = now - timedelta(days=7)
    visible = and_(NewsArticle.is_hidden == False, NewsArticle.is_representative == True)  # noqa: E712
    stat_rows = (await db.execute(
        select(
            NewsArticle.company_id,
            func.count().filter(NewsArticle.published_at >= today0),
            func.count().filter(NewsArticle.published_at >= week),
            func.count().filter(and_(NewsArticle.published_at >= week, NewsArticle.tag == "caution")),
            func.count(),
        ).where(visible).group_by(NewsArticle.company_id)
    )).all()
    stats = {r[0]: {"today": r[1], "week": r[2], "caution_week": r[3], "total": r[4]} for r in stat_rows}

    kw_rows = (await db.execute(select(CompanyKeyword))).scalars().all()
    kws: dict[str, KeywordSet] = {}
    for r in kw_rows:
        ks = kws.setdefault(r.company_id, KeywordSet())
        if r.kind in ("required", "boost", "exclude"):
            getattr(ks, r.kind).append(r.keyword)
    members = await vis.member_names(db, [c.id for c in companies])
    mine_uid = view.member_id
    out = [_out(c, kws.get(c.id, KeywordSet()), stats.get(c.id, {"today": 0, "week": 0, "caution_week": 0, "total": 0}),
                added_by=members.get(c.id, []) if manage_all else [],
                is_mine=any(m["id"] == mine_uid for m in members.get(c.id, [])),
                can_edit=manage_all or any(m["id"] == current_user.id for m in members.get(c.id, [])),
                can_manage=manage_all)
           for c in companies]
    if deleted:  # 삭제된 기업: 누가·왜 목록에서 뺐는지(폴더 완전 삭제 판단용)
        from app.models.user import User

        ids = {c.deleted_by for c in companies if c.deleted_by}
        names = dict((await db.execute(select(User.id, User.nickname).where(User.id.in_(ids or {""})))).all())
        for o, c in zip(out, companies):
            o.deleted_reason = c.deleted_reason
            o.deleted_by_name = names.get(c.deleted_by or "")
    return out


@router.post("/companies", response_model=CompanyOut, status_code=201)
async def create_company(body: CompanyCreate, background: BackgroundTasks,
                         view: View = Depends(get_view), db: AsyncSession = Depends(get_db)):
    """기업 추가 — 보고 있는 사람의 목록에 넣는다(대표가 매니저 화면을 고른 상태면 그 매니저 목록).

    같은 기업(DART 고유번호, 없으면 이름)이 이미 있으면 새로 만들지 않고 목록에만 넣는다 — 기사 수집은 한 번.
    다른 사람이 먼저 추가했는지는 알리지 않는다. 같은 계정이 다시 추가할 때만 '이미 추가한 기업'(409).
    화면에서 삭제된 기업이면 되살려서 넣는다."""
    current_user = view.user
    target = view.member_id
    dup = (await db.execute(select(PortfolioCompany).where(
        (PortfolioCompany.corp_code == body.corp_code) if body.corp_code else (PortfolioCompany.name == body.name)
    ).order_by(PortfolioCompany.deleted_at.is_not(None)))).scalars().first()
    if dup:
        if dup.deleted_at is None and await vis.is_member(db, target, dup.id):
            who = "" if target == current_user.id else f"{view.manager_name or '이 담당자'}님 목록에 "
            raise HTTPException(409, f"{who}이미 추가한 기업입니다: {dup.name}")
        if dup.deleted_at is not None:
            from app.services.company_report import company_delete

            await company_delete.restore(db, dup)
            from sqlalchemy import delete as sa_delete

            from app.models.news_briefing import CompanyMember

            # 되살릴 때는 새로 추가하는 사람 목록에만 넣는다(예전 사람들이 다시 보게 되지 않도록)
            await db.execute(sa_delete(CompanyMember).where(CompanyMember.company_id == dup.id))
        await vis.add_member(db, dup.id, target)
        await db.commit()
        await db.refresh(dup)
        return await _out_one(db, dup, current_user, view=view)
    data = body.model_dump(exclude={"keywords", "backfill_months"})
    data["manager_user_id"] = target if view.mode == "manager" else None  # 기록용(처음 추가한 매니저)
    company = PortfolioCompany(**data)
    db.add(company)
    await db.flush()
    await vis.add_member(db, company.id, target)
    ks = body.keywords
    if not ks.required:
        ks.required = [body.name]
    await _replace_keywords(db, company.id, ks)
    await search.index_company(db, company, ks.required + ks.boost)
    await db.commit()
    await db.refresh(company)
    if body.backfill_months > 0:
        background.add_task(_run_initial_backfill, company.id, body.backfill_months, current_user.id)
    return await _out_one(db, company, current_user, view=view)


async def _run_initial_backfill(company_id: str, months: int, user_id: str) -> None:
    """등록 직후 과거 데이터 구축(네이버·구글 RSS·DART + 검증). 별도 세션에서 실행."""

    from app.services.company_report import backfill

    async with AsyncSessionLocal() as db:
        await backfill.run_backfill(db, company_id, months=months, trigger="register", user_id=user_id)


@router.get("/companies/{company_id}", response_model=CompanyOut)
async def get_company(company_id: str, view: View = Depends(get_view), db: AsyncSession = Depends(get_db)):
    current_user = view.user
    c = await assert_company(db, current_user, company_id)
    now = now_kst()
    today0 = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week = now - timedelta(days=7)
    row = (await db.execute(
        select(
            func.count().filter(NewsArticle.published_at >= today0),
            func.count().filter(NewsArticle.published_at >= week),
            func.count().filter(and_(NewsArticle.published_at >= week, NewsArticle.tag == "caution")),
            func.count(),
        ).where(NewsArticle.company_id == c.id, NewsArticle.is_hidden == False, NewsArticle.is_representative == True)  # noqa: E712
    )).one()
    return await _out_one(db, c, current_user, {"today": row[0], "week": row[1], "caution_week": row[2], "total": row[3]}, view=view)


@router.put("/companies/{company_id}", response_model=CompanyOut)
async def update_company(company_id: str, body: CompanyUpdate, background: BackgroundTasks,
                         view: View = Depends(get_view), db: AsyncSession = Depends(get_db)):
    current_user = view.user
    c = await assert_company(db, current_user, company_id, write=True)
    data = body.model_dump(exclude_unset=True, exclude={"keywords"})
    data.pop("manager_user_id", None)  # (예전) 담당 바꾸기 — 더 쓰지 않음
    if "is_active" in data and data["is_active"] != c.is_active and not await vis.can_manage_all(db, current_user):
        raise HTTPException(403, "비활성·다시 활성은 대표(또는 기업 리포트 관리자)만 할 수 있습니다.")
    if "name" in data and data["name"] and data["name"] != c.name:
        # 이전 사명은 별칭으로 보존(검색·기업DB용)
        aliases = list(c.aliases or [])
        if c.name not in aliases:
            aliases.append(c.name)
        c.aliases = aliases
    for k, v in data.items():
        setattr(c, k, v)
    kw_changed = False
    if body.keywords is not None:
        before = await _keywords(db, c.id)
        kw_changed = any(sorted(getattr(before, k)) != sorted(getattr(body.keywords, k)) for k in ("required", "boost", "exclude"))
        await _replace_keywords(db, c.id, body.keywords)
    await db.flush()
    ks = await _keywords(db, c.id)
    await search.index_company(db, c, ks.required + ks.boost)
    await db.commit()
    await db.refresh(c)
    if kw_changed and c.is_active:
        # 바뀐 키워드로 최근 6개월을 다시 훑는다(이미 있는 기사는 건너뜀)
        background.add_task(_run_backfill_jobs, [(c.id, None)], {"months": 6, "trigger": "keyword_change", "user_id": current_user.id})
    return await _out_one(db, c, current_user, view=view)


@router.delete("/companies/{company_id}", status_code=204)
async def deactivate_company(company_id: str, current_user=Depends(get_current_user),
                             db: AsyncSession = Depends(get_db)):
    """삭제하지 않고 비활성화한다(수집만 멈추고 데이터는 보존). 모든 사람에게 영향 → 대표·관리자만."""
    c = await vis.assert_company_admin(db, current_user, company_id)
    c.is_active = False
    await search.index_company(db, c)
    await db.commit()


@router.post("/companies/{company_id}/collect")
async def collect_now(company_id: str, background: BackgroundTasks, current_user=Depends(get_current_user),
                      db: AsyncSession = Depends(get_db)):
    await assert_company(db, current_user, company_id, write=True)
    background.add_task(_run_collect, company_id)
    return {"queued": True}


async def _run_collect(company_id: str) -> None:
    from app.services.company_report import collector

    async with AsyncSessionLocal() as db:
        await collector.collect_company(db, company_id, via="manual")
        from app.services.company_report import summarizer

        await summarizer.summarize_pending(db, company_id=company_id, limit=100)
        from app.services.company_report import facts

        await facts.extract_pending(db, company_id=company_id, limit=100)


# --------------------------------------------------------------------------- 기사·백필 기록

class ArticlePatch(BaseModel):
    is_hidden: Optional[bool] = None
    tag: Optional[str] = None


def _article_out(a: NewsArticle) -> dict:
    return {
        "id": a.id, "company_id": a.company_id, "source_type": a.source_type, "source": a.source,
        "url": a.url, "title": a.title, "press": a.press,
        "published_at": a.published_at.isoformat() if a.published_at else None,
        "summary": a.summary, "tag": a.tag, "issue_type": a.issue_type,
        "relevance_score": a.relevance_score, "is_hidden": a.is_hidden,
        "dup_group_id": a.dup_group_id,
    }


@router.get("/companies/{company_id}/articles")
async def list_articles(company_id: str, tag: Optional[str] = None, source_type: Optional[str] = None,
                        on_date: Optional[date] = Query(None, alias="date"), date_from: Optional[date] = None, date_to: Optional[date] = None,
                        include_hidden: bool = False, page: int = Query(1, ge=1), size: int = Query(30, ge=1, le=100),
                        current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """기업별 누적 기사(대표 기사만, 최신순). 날짜별 묶음은 화면에서 한다."""
    await assert_company(db, current_user, company_id)
    cond = [NewsArticle.company_id == company_id, NewsArticle.is_representative == True]  # noqa: E712
    if not include_hidden:
        cond.append(NewsArticle.is_hidden == False)  # noqa: E712
    if tag:
        cond.append(NewsArticle.tag == tag)
    if source_type:
        cond.append(NewsArticle.source_type == source_type)
    if on_date:
        date_from = date_to = on_date
    if date_from:
        cond.append(NewsArticle.published_at >= datetime.combine(date_from, datetime.min.time()))
    if date_to:
        cond.append(NewsArticle.published_at < datetime.combine(date_to + timedelta(days=1), datetime.min.time()))
    total = (await db.execute(select(func.count()).select_from(NewsArticle).where(*cond))).scalar_one()
    rows = (await db.execute(
        select(NewsArticle).where(*cond)
        .order_by(NewsArticle.published_at.desc().nullslast())
        .offset((page - 1) * size).limit(size)
    )).scalars().all()
    return {"total": total, "page": page, "size": size, "items": [_article_out(a) for a in rows]}


@router.patch("/articles/{article_id}")
async def patch_article(article_id: str, body: ArticlePatch, current_user=Depends(get_current_user),
                        db: AsyncSession = Depends(get_db)):
    """관련 없음(숨김)·태그 수정 — 이후 브리핑·보고서에서 빠진다."""
    a = await db.get(NewsArticle, article_id)
    if not a:
        raise HTTPException(404, "기사를 찾을 수 없습니다.")
    await assert_company(db, current_user, a.company_id, write=True)
    if body.is_hidden is not None:
        a.is_hidden = body.is_hidden
        a.hidden_at = now_kst() if body.is_hidden else None
        a.hidden_by = current_user.id if body.is_hidden else None
    if body.tag is not None:
        if body.tag not in ("positive", "neutral", "caution"):
            raise HTTPException(422, "tag는 positive/neutral/caution 중 하나입니다.")
        a.tag = body.tag
    await search.index_article(db, a)
    await db.commit()
    return _article_out(a)


# --------------------------------------------------------------------------- 폰 전용 화면(로그인 없음, 열쇠값 필요)

async def _mobile_subject(db: AsyncSession, kind: str, t: str) -> tuple[str, Optional[set[str]]]:
    """(날짜·월 키, 볼 수 있는 기업 id). 받는 사람의 명단 주인(담당자) 기준으로 카드를 거른다."""
    from app.services.company_report import mobile_link

    try:
        key, subject = mobile_link.parse(kind, t)
    except mobile_link.LinkError as e:
        raise HTTPException(403, str(e))
    if not await mobile_link.subject_active(db, subject):
        raise HTTPException(403, "브리핑 수신자가 아니거나 해제되었습니다. Working Hub에 로그인해서 확인해 주세요.")
    return key, await mobile_link.subject_company_ids(db, subject)


@router.get("/m/daily")
async def mobile_daily(t: str = Query(..., max_length=200), db: AsyncSession = Depends(get_db)):
    """카톡 [브리핑 보기] → 폰 화면용 데일리 브리핑(요약 + 문장별 원문 링크). 로그인 없이 열쇠값으로."""
    from app.services.company_report import mobile_view

    key, ids = await _mobile_subject(db, "d", t)
    try:
        day = date.fromisoformat(key)
    except ValueError:
        raise HTTPException(404, "브리핑이 없습니다.")
    b = (await db.execute(select(NewsBriefing).where(NewsBriefing.briefing_date == day))).scalar_one_or_none()
    if not b:
        raise HTTPException(404, "브리핑이 없습니다.")
    return mobile_view.daily_view(vis.filter_daily(b, ids))


@router.get("/m/monthly")
async def mobile_monthly(t: str = Query(..., max_length=200), db: AsyncSession = Depends(get_db)):
    from app.models.company_report import MonthlyBriefing
    from app.services.company_report import mobile_view

    key, ids = await _mobile_subject(db, "m", t)
    mb = (await db.execute(select(MonthlyBriefing).where(MonthlyBriefing.month == key))).scalar_one_or_none()
    if not mb:
        raise HTTPException(404, "월간 브리핑이 없습니다.")
    return await mobile_view.monthly_view(db, vis.filter_monthly(mb, ids))


@router.get("/r/{code}", include_in_schema=False)
async def short_link_redirect(code: str, db: AsyncSession = Depends(get_db)):
    """카톡 브리핑의 짧은 기사 링크(로그인 불필요) → 원문 기사로 이동."""
    from fastapi.responses import RedirectResponse

    from app.services.company_report import config as crcfg_web, shortlink

    url = await shortlink.resolve(db, code[:12]) if code.isalnum() else None
    return RedirectResponse(url or crcfg_web.WEB_BASE, status_code=302)


@router.get("/articles/{article_id}/content")
async def article_content(article_id: str, current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """목록에서 제목을 누르면 펼쳐 보여줄 기사 본문(원문 사이트에서 본문만 추출)."""
    from app.services.company_report import article_reader
    from app.services.company_report.keys import release

    a = await db.get(NewsArticle, article_id)
    if not a:
        raise HTTPException(404, "기사를 찾을 수 없습니다.")
    await assert_company(db, current_user, a.company_id)
    url = a.url
    await release(db)
    r = await article_reader.read(url)
    return {"article_id": article_id, "source_url": url, **r}


def _job_out(j, full: bool = False) -> dict:
    cov = j.coverage or {}
    out = {
        "id": j.id, "company_id": j.company_id, "period_from": j.period_from.isoformat(), "period_to": j.period_to.isoformat(),
        "trigger": j.trigger, "status": j.status, "progress": j.progress, "stage": cov.get("stage"),
        "source_stats": j.source_stats, "verdict": j.verdict, "estimated_recall": j.estimated_recall,
        "reasons": cov.get("reasons") or [], "report_file_id": j.report_file_id, "error": j.error,
        "created_at": j.created_at.isoformat() if j.created_at else None,
        "finished_at": j.finished_at.isoformat() if j.finished_at else None,
        "coverage": {"hit_limit_queries": (cov.get("checks") or {}).get("c1", {}).get("hit_limit") or cov.get("hit_limit_queries") or []},
    }
    if full:
        out.update({"checks": cov.get("checks") or {}, "confirmed_gaps": cov.get("confirmed_gaps") or [],
                    "key_events": j.key_events or {}, "sample": {k: v for k, v in (j.sample_review or {}).items() if k != "items"}})
    return out


@router.get("/companies/{company_id}/backfill-jobs")
async def list_backfill_jobs(company_id: str, current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await assert_company(db, current_user, company_id)
    rows = (await db.execute(
        select(BackfillJob).where(BackfillJob.company_id == company_id).order_by(BackfillJob.created_at.desc()).limit(10)
    )).scalars().all()
    return [_job_out(j) for j in rows]


class BackfillBody(BaseModel):
    company_ids: list[str]
    months: Optional[int] = Field(default=6, ge=1, le=12)
    date_from: Optional[date] = None
    date_to: Optional[date] = None


@router.post("/companies/backfill")
async def start_backfill(body: BackfillBody, background: BackgroundTasks, current_user=Depends(get_current_user),
                         db: AsyncSession = Depends(get_db)):
    """[과거 데이터 가져오기] — 여러 기업·기간. 기업마다 작업을 만들고 차례로 실행."""
    if not body.company_ids:
        raise HTTPException(422, "기업을 골라 주세요.")
    await vis.assert_company_ids(db, current_user, body.company_ids, write=True)
    if body.date_from and body.date_to and ((body.date_to - body.date_from).days > 370 or body.date_to < body.date_from):
        raise HTTPException(422, "기간은 최대 12개월입니다.")
    running = (await db.execute(select(BackfillJob.company_id).where(
        BackfillJob.company_id.in_(body.company_ids), BackfillJob.status.in_(["queued", "running"])))).scalars().all()
    end = body.date_to or today_kst()
    start = body.date_from or (end - timedelta(days=30 * (body.months or 6)))
    jobs = []
    for cid in body.company_ids:
        if cid in running:
            continue
        j = BackfillJob(company_id=cid, period_from=start, period_to=end, trigger="manual", status="queued", created_by=current_user.id)
        db.add(j)
        jobs.append(j)
    await db.commit()
    background.add_task(_run_backfill_jobs, [(j.company_id, j.id) for j in jobs],
                        {"date_from": start, "date_to": end, "trigger": "manual", "user_id": current_user.id})
    return {"queued": len(jobs), "skipped_running": len(running), "job_ids": [j.id for j in jobs]}


async def _run_backfill_jobs(pairs: list[tuple[str, Optional[str]]], opts: dict) -> None:
    from app.services.company_report import backfill

    for cid, job_id in pairs:
        async with AsyncSessionLocal() as db:
            try:
                await backfill.run_backfill(db, cid, job_id=job_id, **opts)
            except Exception:
                logger.exception("백필 작업 실패(%s)", cid)


@router.get("/backfill-jobs/{job_id}")
async def get_backfill_job(job_id: str, current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from app.services.company_report import backfill

    j = await db.get(BackfillJob, job_id)
    if not j:
        raise HTTPException(404, "작업을 찾을 수 없습니다.")
    await assert_company(db, current_user, j.company_id)
    return {**_job_out(j, full=True), "counts": await backfill.monthly_counts(db, j)}


@router.get("/backfill-jobs/{job_id}/sample")
async def get_backfill_sample(job_id: str, current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    j = await db.get(BackfillJob, job_id)
    if not j:
        raise HTTPException(404, "작업을 찾을 수 없습니다.")
    await assert_company(db, current_user, j.company_id)
    sample = j.sample_review or {}
    ids = [x["article_id"] for x in sample.get("items") or []]
    arts = {a.id: a for a in (await db.execute(select(NewsArticle).where(NewsArticle.id.in_(ids or [""])))).scalars().all()}
    return {"answers": sample.get("answers") or {}, "accuracy": sample.get("accuracy"),
            "items": [_article_out(arts[i]) for i in ids if i in arts]}


class SampleReviewBody(BaseModel):
    answers: dict[str, bool]


@router.post("/backfill-jobs/{job_id}/sample-review")
async def post_sample_review(job_id: str, body: SampleReviewBody, current_user=Depends(get_current_user),
                             db: AsyncSession = Depends(get_db)):
    """⑤ 담당자 검수: 틀림(관련 없음)으로 고른 기사는 숨기고 다시 판정한다."""
    from app.services.company_report import backfill

    j = await db.get(BackfillJob, job_id)
    if not j:
        raise HTTPException(404, "작업을 찾을 수 없습니다.")
    await assert_company(db, current_user, j.company_id, write=True)
    ids = {x["article_id"] for x in (j.sample_review or {}).get("items") or []}
    answers = {k: v for k, v in body.answers.items() if k in ids}
    for aid, ok in answers.items():
        if not ok:
            a = await db.get(NewsArticle, aid)
            if a and not a.is_hidden:
                a.is_hidden, a.hidden_at, a.hidden_by = True, now_kst(), current_user.id
                await search.index_article(db, a)
    j.sample_review = {**(j.sample_review or {}), "answers": answers, "reviewed_by": current_user.id}
    await backfill.refresh_verdict(db, j)
    return _job_out(j, full=True)


class GapsBody(BaseModel):
    months: list[str]


@router.post("/backfill-jobs/{job_id}/confirm-gaps")
async def post_confirm_gaps(job_id: str, body: GapsBody, current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """① 기사 0건인 달을 '실제로 기사 없음'으로 확인."""
    from app.services.company_report import backfill

    j = await db.get(BackfillJob, job_id)
    if not j:
        raise HTTPException(404, "작업을 찾을 수 없습니다.")
    await assert_company(db, current_user, j.company_id, write=True)
    j.coverage = {**(j.coverage or {}), "confirmed_gaps": sorted(set((j.coverage or {}).get("confirmed_gaps") or []) | set(body.months))}
    await backfill.refresh_verdict(db, j)
    return _job_out(j, full=True)


@router.get("/me")
async def me(current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """화면에서 관리자 전용 버튼(승인 등) 표시 여부. can_claim: 아직 관리자가 없어 내가 지정할 수 있음."""
    from app.services.company_report import admin

    from app.core.permissions import is_owner

    out = {"id": current_user.id, "name": getattr(current_user, "nickname", ""),
           "is_admin": await admin.is_admin(db, current_user), "can_claim": await admin.can_claim(db),
           "is_owner": is_owner(current_user)}
    if not is_owner(current_user):
        out["self_send"] = await _self_send_info(db, current_user)
    return out


async def _self_send_info(db: AsyncSession, user) -> dict:
    """매니저 본인 자동 발송 상태(브리핑 탭 안내용)."""
    from app.models.news_briefing import CompanyMember
    from app.services import settings_store
    from app.services.company_report import config as crcfg

    n = (await db.execute(select(func.count()).select_from(CompanyMember).join(
        PortfolioCompany, PortfolioCompany.id == CompanyMember.company_id).where(
        CompanyMember.user_id == user.id, PortfolioCompany.is_active == True,  # noqa: E712
        PortfolioCompany.deleted_at.is_(None)))).scalar_one()
    return {"enabled": await settings_store.get_bool(db, crcfg.BRIEFING_ENABLED, default=False),
            "has_phone": bool(user.phone), "phone_masked": _mask_phone(user.phone), "company_count": n}


@router.post("/admins/claim")
async def claim_admin(current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """기업 리포트 관리자가 아직 없을 때만: 내 계정을 첫 관리자로 지정."""
    from app.services.company_report import admin

    if not await admin.can_claim(db):
        raise HTTPException(409, "이미 관리자가 있습니다. 관리자에게 추가를 요청하세요.")
    await admin.set_admins(db, [current_user.id])
    return {"is_admin": True}


@router.get("/admins")
async def list_admins(current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from app.models.user import User
    from app.services.company_report import admin

    ids = await admin.admin_ids(db)
    from app.core.permissions import OWNER

    # 대표는 항상 관리자(docs/login_logic D-2) → 목록에도 보여 준다
    users = (await db.execute(select(User).where(
        (User.id.in_(ids or [""])) | (User.is_superuser == True) | ((User.role == OWNER) & (User.is_active == True))  # noqa: E712
    ))).scalars().all()
    return [{"user_id": u.id, "name": u.nickname, "email": u.email, "superuser": bool(u.is_superuser)} for u in users]


class AdminsBody(BaseModel):
    user_ids: list[str]


@router.put("/admins")
async def put_admins(body: AdminsBody, current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from app.services.company_report import admin

    await require_admin(db, current_user)
    ids = list(body.user_ids)
    if not getattr(current_user, "is_superuser", False) and current_user.id not in ids:
        ids.append(current_user.id)  # 자기 자신은 빼지 못하게(관리자가 0명이 되는 것 방지)
    return {"user_ids": await admin.set_admins(db, ids)}


# --------------------------------------------------------------------------- 데일리 브리핑

def _briefing_out(b: NewsBriefing) -> dict:
    return {
        "id": b.id, "briefing_date": b.briefing_date.isoformat(), "status": b.status,
        "basic_info": b.basic_info or {}, "overall_summary": b.overall_summary or "",
        "overall": ((b.review_summary or {}).get("overall")) or [
            {"text": t, "source_ids": []} for t in (b.overall_summary or "").split("\n") if t.strip()
        ],
        "company_summaries": b.company_summaries or [], "article_count": b.article_count,
        "caution_count": b.caution_count, "is_fallback": b.is_fallback,
        "review_summary": {k: v for k, v in (b.review_summary or {}).items() if k != "overall"},
        "approved_by": b.approved_by, "approved_at": b.approved_at.isoformat() if b.approved_at else None,
        "sent_at": b.sent_at.isoformat() if b.sent_at else None,
        "created_at": b.created_at.isoformat() if b.created_at else None,
    }


@router.get("/briefings/daily")
async def get_daily_briefing(date_: Optional[date] = Query(None, alias="date"), view: View = Depends(get_view),
                             db: AsyncSession = Depends(get_db)):
    """해당 날짜 브리핑. 날짜가 없으면 가장 최근 것. 보는 담당자의 기업 카드만 남긴다(docs/login_logic P9)."""
    stmt = select(NewsBriefing)
    stmt = stmt.where(NewsBriefing.briefing_date == date_) if date_ else stmt.order_by(NewsBriefing.briefing_date.desc()).limit(1)
    b = (await db.execute(stmt)).scalars().first()
    if not b:
        raise HTTPException(404, "브리핑이 없습니다.")
    return _briefing_out(vis.filter_daily(b, await vis.visible_company_ids(db, view)))


@router.get("/briefings/daily/list")
async def list_daily_briefings(limit: int = Query(30, ge=1, le=120), view: View = Depends(get_view),
                               db: AsyncSession = Depends(get_db)):
    ids = await vis.visible_company_ids(db, view)
    if ids is None:
        rows = (await db.execute(
            select(NewsBriefing.id, NewsBriefing.briefing_date, NewsBriefing.status, NewsBriefing.article_count,
                   NewsBriefing.caution_count, NewsBriefing.is_fallback)
            .order_by(NewsBriefing.briefing_date.desc()).limit(limit)
        )).all()
        return [{"id": r[0], "briefing_date": r[1].isoformat(), "status": r[2], "article_count": r[3],
                 "caution_count": r[4], "is_fallback": r[5]} for r in rows]
    out = []
    for r in (await db.execute(
        select(NewsBriefing.id, NewsBriefing.briefing_date, NewsBriefing.status, NewsBriefing.company_summaries,
               NewsBriefing.is_fallback).order_by(NewsBriefing.briefing_date.desc()).limit(limit)
    )).all():
        cards = [c for c in (r[3] or []) if c.get("company_id") in ids]
        out.append({"id": r[0], "briefing_date": r[1].isoformat(), "status": r[2],
                    "article_count": sum(int(c.get("article_count") or 0) for c in cards),
                    "caution_count": sum(int(c.get("caution_count") or 0) for c in cards), "is_fallback": r[4]})
    return out


class BuildRequest(BaseModel):
    briefing_date: Optional[date] = None
    collect: bool = True


@router.post("/briefings/daily/build")
async def build_daily_now(body: BuildRequest, background: BackgroundTasks, current_user=Depends(get_current_user),
                          db: AsyncSession = Depends(get_db)):
    """관리자: 브리핑을 지금 다시 만든다(휴일이어도, 마감 시간 제한 없이)."""
    await require_admin(db, current_user)
    background.add_task(_run_build_daily, body.briefing_date, body.collect)
    return {"queued": True}


async def _run_build_daily(day: Optional[date], collect: bool) -> None:
    from app.services.company_report import daily

    async with AsyncSessionLocal() as db:
        try:
            await daily.build_daily(db, day, collect=collect, force=True, use_deadline=False)
        except Exception:
            logger.exception("수동 데일리 작성 실패")


@router.post("/briefings/daily/{briefing_id}/approve")
async def approve_daily(briefing_id: str, current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """관리자 승인(승인 기간 동안만 필요). 승인된 브리핑은 08:30 발송 배치가 보낸다."""
    await require_admin(db, current_user)
    b = await db.get(NewsBriefing, briefing_id)
    if not b:
        raise HTTPException(404, "브리핑이 없습니다.")
    if b.status == "sent":
        raise HTTPException(409, "이미 발송된 브리핑입니다.")
    b.status, b.approved_by, b.approved_at = "approved", current_user.id, now_kst()
    await db.commit()
    return _briefing_out(b)


# --------------------------------------------------------------------------- 월간 브리핑(P3)

MONTH_PATTERN = r"^\d{4}-(0[1-9]|1[0-2])$"


def _monthly_out(mb) -> dict:
    return {
        "id": mb.id, "month": mb.month, "status": mb.status, "content": mb.content or {}, "stats": mb.stats or {},
        "review_summary": mb.review_summary or {}, "hold_reason": mb.hold_reason,
        "approved_by": mb.approved_by, "approved_at": mb.approved_at.isoformat() if mb.approved_at else None,
        "sent_at": mb.sent_at.isoformat() if mb.sent_at else None,
        "created_at": mb.created_at.isoformat() if mb.created_at else None,
        "updated_at": mb.updated_at.isoformat() if mb.updated_at else None,
    }


async def _get_monthly(db: AsyncSession, monthly_id: str):
    from app.models.company_report import MonthlyBriefing

    mb = await db.get(MonthlyBriefing, monthly_id)
    if not mb:
        raise HTTPException(404, "월간 브리핑이 없습니다.")
    return mb


@router.get("/briefings/monthly")
async def get_monthly_briefing(month: Optional[str] = Query(None, pattern=MONTH_PATTERN), view: View = Depends(get_view),
                               db: AsyncSession = Depends(get_db)):
    """해당 월 월간 브리핑. 월이 없으면 가장 최근 것."""
    from app.models.company_report import MonthlyBriefing

    stmt = select(MonthlyBriefing)
    stmt = stmt.where(MonthlyBriefing.month == month) if month else stmt.order_by(MonthlyBriefing.month.desc()).limit(1)
    mb = (await db.execute(stmt)).scalars().first()
    if not mb:
        raise HTTPException(404, "월간 브리핑이 없습니다.")
    return _monthly_out(vis.filter_monthly(mb, await vis.visible_company_ids(db, view)))


@router.get("/briefings/monthly/list")
async def list_monthly_briefings(limit: int = Query(24, ge=1, le=60), view: View = Depends(get_view),
                                 db: AsyncSession = Depends(get_db)):
    from app.models.company_report import MonthlyBriefing

    ids = await vis.visible_company_ids(db, view)
    rows = (await db.execute(select(MonthlyBriefing).order_by(MonthlyBriefing.month.desc()).limit(limit))).scalars().all()
    rows = [vis.filter_monthly(m, ids) for m in rows]
    return [{"id": m.id, "month": m.month, "status": m.status, "article_count": (m.stats or {}).get("article_count", 0),
             "caution_count": (m.stats or {}).get("caution_count", 0)} for m in rows]


class MonthlyBuildRequest(BaseModel):
    month: Optional[str] = Field(None, pattern=MONTH_PATTERN)


@router.post("/briefings/monthly/build")
async def build_monthly_now(body: MonthlyBuildRequest, background: BackgroundTasks, current_user=Depends(get_current_user),
                            db: AsyncSession = Depends(get_db)):
    """관리자: 월간 브리핑을 지금 (다시) 만든다. 월이 없으면 지난 달. 기업 수에 따라 5~20분 걸린다."""
    await require_admin(db, current_user)
    from app.models.company_report import MonthlyBriefing
    from app.services.company_report import monthly

    month = body.month or monthly.target_month_for(today_kst())
    mb = (await db.execute(select(MonthlyBriefing).where(MonthlyBriefing.month == month))).scalar_one_or_none()
    if mb and mb.status == "sent":
        raise HTTPException(409, "이미 발송된 월간 브리핑은 다시 만들 수 없습니다.")
    if mb and mb.status == "generating" and mb.updated_at and (now_kst() - mb.updated_at).total_seconds() < 3600:
        raise HTTPException(409, "지금 만드는 중입니다. 잠시 뒤 새로고침하세요.")
    background.add_task(_run_build_monthly, month)
    return {"queued": True, "month": month}


async def _run_build_monthly(month: str) -> None:
    from app.services.company_report import monthly

    async with AsyncSessionLocal() as db:
        try:
            await monthly.build_monthly(db, month, force=True)
        except Exception:
            logger.exception("수동 월간 작성 실패")


class HoldBody(BaseModel):
    reason: Optional[str] = None


@router.post("/briefings/monthly/{monthly_id}/release")
async def release_monthly(monthly_id: str, current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """관리자: 보류(held)된 월간 브리핑을 확인하고 [발송 허용] → ready."""
    await require_admin(db, current_user)
    from app.services.company_report import monthly

    mb = await _get_monthly(db, monthly_id)
    try:
        return _monthly_out(await monthly.set_hold(db, mb, False, current_user.id))
    except ValueError as e:
        raise HTTPException(409, str(e))


@router.post("/briefings/monthly/{monthly_id}/hold")
async def hold_monthly(monthly_id: str, body: HoldBody, current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_admin(db, current_user)
    from app.services.company_report import monthly

    mb = await _get_monthly(db, monthly_id)
    try:
        return _monthly_out(await monthly.set_hold(db, mb, True, current_user.id, body.reason))
    except ValueError as e:
        raise HTTPException(409, str(e))


@router.post("/briefings/monthly/{monthly_id}/test-send")
async def test_send_monthly(monthly_id: str, recipient_id: Optional[str] = None, view: View = Depends(get_view),
                            db: AsyncSession = Depends(get_db)):
    from app.services.company_report import sender

    r = await sender.send_monthly_test(db, monthly_id, view.user, recipient_id, view=view)
    if not r.get("success"):
        raise HTTPException(400, f"테스트 발송 실패: {r.get('error')}")
    return r


@router.post("/briefings/monthly/{monthly_id}/send-now")
async def send_monthly_now(monthly_id: str, current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """관리자: 발송 허용(ready)된 월간 브리핑을 지금 수신자 전원에게 보낸다(중복 발송 차단)."""
    await require_admin(db, current_user)
    from app.services.company_report import monthly, sender

    mb = await _get_monthly(db, monthly_id)
    nm = monthly.next_month(mb.month)
    return await sender.send_monthly(db, date(int(nm[:4]), int(nm[5:7]), 1), ignore_day=True)


@router.get("/companies/{company_id}/digests")
async def company_digests(company_id: str, current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """기업 원장 탭의 월간 요약 목록."""
    from app.services.company_report import monthly

    await assert_company(db, current_user, company_id)
    return await monthly.digests_for(db, company_id)


# --------------------------------------------------------------------------- 발송: 수신자·설정·테스트

def _mask_phone(p: Optional[str]) -> Optional[str]:
    d = "".join(ch for ch in (p or "") if ch.isdigit())
    return f"{d[:3]}-****-{d[-4:]}" if len(d) >= 8 else None


def _list_view(view: View) -> View:
    """수신자 명단은 회사(대표) 명단 하나뿐(2026-10-01). 매니저는 본인 휴대폰으로 자동 발송된다."""
    return view


@router.get("/recipients")
async def get_recipients(view: View = Depends(get_view), db: AsyncSession = Depends(get_db)):
    """회사 수신자 명단 + 직원 계정 목록(빠른 선택용). 대표·관리자만(매니저는 본인 자동 발송)."""
    from app.models.user import User
    from app.services.company_report import sender

    await require_admin(db, view.user)
    targets = await sender.recipient_targets(db, include_no_phone=True, list_owner=view.list_owner)
    selected = [{"id": t.recipient_id, "kind": t.kind, "ref_id": t.user_id or t.client_id, "name": t.name,
                 "phone_masked": _mask_phone(t.phone), "has_phone": bool(t.phone)} for t in targets]
    chosen_users = {t.user_id for t in targets if t.user_id}
    users = (await db.execute(select(User).where(User.is_active == True).order_by(User.nickname))).scalars().all()  # noqa: E712
    staff = [{"kind": "user", "ref_id": u.id, "name": u.nickname, "detail": u.email, "phone_masked": _mask_phone(u.phone),
              "has_phone": bool(u.phone), "selected": u.id in chosen_users} for u in users]
    return {"selected": selected, "staff": staff, "view": view.as_dict()}


@router.get("/recipients/search")
async def search_recipients(q: str = Query(..., min_length=1, max_length=50), view: View = Depends(get_view),
                            db: AsyncSession = Depends(get_db)):
    """이름으로 찾기: 데이터 관리 > 고객 정보 관리(clients) + 직원 계정(users).
    고객은 명단 주인의 담당 고객만(대표의 회사 명단이면 전체)."""
    from app.models.client import Client
    from app.models.user import User

    await require_admin(db, view.user)
    current_user = view.user
    like = f"%{q.strip()}%"
    in_list = _recipient_list_cond(view.list_owner)
    chosen = set((await db.execute(select(BriefingRecipient.client_id).where(
        BriefingRecipient.client_id.is_not(None), in_list))).scalars().all())
    chosen_u = set((await db.execute(select(BriefingRecipient.user_id).where(
        BriefingRecipient.user_id.is_not(None), in_list))).scalars().all())
    owners = aliased(User)
    from app.core.permissions import scope_clients

    # 고객 검색은 담당 고객만 (대표는 전체) — docs/login_logic
    stmt = (select(Client, owners.nickname).outerjoin(owners, owners.id == Client.user_id)
            .where(Client.name.ilike(like)).order_by(Client.name).limit(30))
    if view.list_owner:  # 매니저 명단: 그 매니저 담당 고객만(대표가 매니저 화면을 골라도 같음)
        stmt = stmt.where(Client.user_id == view.list_owner)
    rows = (await db.execute(scope_clients(stmt, current_user))).all()
    out = [{"kind": "client", "ref_id": c.id, "name": c.name,
            "detail": " · ".join(x for x in ["고객 정보 관리", f"고유번호 {c.unique_code}" if c.unique_code else "",
                                             f"담당 {owner}" if owner else "",
                                             f"{c.birth_date.year}년생" if c.birth_date else ""] if x),
            "phone_masked": _mask_phone(c.phone), "has_phone": bool(c.phone), "selected": c.id in chosen}
           for c, owner in rows]
    users = (await db.execute(select(User).where(User.is_active == True, User.nickname.ilike(like)).limit(10))).scalars().all()  # noqa: E712
    out += [{"kind": "user", "ref_id": u.id, "name": u.nickname, "detail": f"직원 계정 · {u.email}",
             "phone_masked": _mask_phone(u.phone), "has_phone": bool(u.phone), "selected": u.id in chosen_u} for u in users]
    return out


def _recipient_list_cond(list_owner: Optional[str]):
    return (BriefingRecipient.manager_user_id == list_owner) if list_owner else BriefingRecipient.manager_user_id.is_(None)


async def _assert_list_editable(db: AsyncSession, view: View) -> None:
    """회사 명단은 대표·기업 리포트 관리자만."""
    await require_admin(db, view.user)


class RecipientAdd(BaseModel):
    kind: str  # client/user
    ref_id: str


@router.post("/recipients", status_code=201)
async def add_recipient(body: RecipientAdd, view: View = Depends(get_view), db: AsyncSession = Depends(get_db)):
    from app.core.permissions import assert_client
    from app.models.client import Client
    from app.models.user import User

    await _assert_list_editable(db, view)
    lo = view.list_owner
    in_list = _recipient_list_cond(lo)
    count = (await db.execute(select(func.count()).select_from(BriefingRecipient).where(
        BriefingRecipient.is_active == True, in_list))).scalar_one()  # noqa: E712
    if body.kind == "client":
        c = await assert_client(db, view.user, body.ref_id)
        if lo and c.user_id != lo:
            raise HTTPException(422, f"{c.name}님은 이 매니저의 담당 고객이 아닙니다.")
        if not c.phone:
            raise HTTPException(422, f"{c.name}님은 고객 정보에 휴대폰 번호가 없습니다. 고객 정보 관리에서 먼저 입력하세요.")
        r = (await db.execute(select(BriefingRecipient).where(BriefingRecipient.client_id == c.id, in_list))).scalar_one_or_none()
        name = c.name
    elif body.kind == "user":
        u = await db.get(User, body.ref_id)
        if not u:
            raise HTTPException(404, "직원 계정을 찾을 수 없습니다.")
        if not u.phone:
            raise HTTPException(422, f"{u.nickname}님 계정에 휴대폰 번호가 없습니다. 고객 정보 관리에서 이름으로 찾아 추가해 보세요.")
        r = (await db.execute(select(BriefingRecipient).where(BriefingRecipient.user_id == u.id, in_list))).scalar_one_or_none()
        name = u.nickname
    else:
        raise HTTPException(422, "kind는 client 또는 user입니다.")
    if r and r.is_active:
        raise HTTPException(409, f"{name}님은 이미 수신자입니다.")
    if count >= 5:
        raise HTTPException(422, "수신자는 최대 5명입니다.")
    if r:
        r.is_active, r.name = True, name
    else:
        db.add(BriefingRecipient(user_id=body.ref_id if body.kind == "user" else None,
                                 client_id=body.ref_id if body.kind == "client" else None, name=name, is_active=True,
                                 manager_user_id=lo))
    await db.commit()
    return {"name": name}


@router.delete("/recipients/{recipient_id}", status_code=204)
async def remove_recipient(recipient_id: str, view: View = Depends(get_view), db: AsyncSession = Depends(get_db)):
    await _assert_list_editable(db, view)
    r = await db.get(BriefingRecipient, recipient_id)
    if not r or r.manager_user_id != view.list_owner:
        raise HTTPException(404, "수신자를 찾을 수 없습니다.")
    await db.delete(r)
    await db.commit()


class RecipientsBody(BaseModel):
    user_ids: list[str]


@router.put("/recipients")
async def put_recipients(body: RecipientsBody, view: View = Depends(get_view), db: AsyncSession = Depends(get_db)):
    """(이전 방식) 직원 계정 목록으로 한 번에 지정. 고객 정보에서 추가한 수신자는 유지한다. 보는 담당자의 명단 기준."""
    await _assert_list_editable(db, view)
    in_list = _recipient_list_cond(view.list_owner)
    from app.models.user import User

    ids = list(dict.fromkeys(body.user_ids))
    users = (await db.execute(select(User).where(User.id.in_(ids or [""])))).scalars().all()
    no_phone = [u.nickname for u in users if not u.phone]
    if no_phone:
        raise HTTPException(422, f"휴대폰 번호가 없는 직원: {', '.join(no_phone)}")
    clients_n = (await db.execute(select(func.count()).select_from(BriefingRecipient).where(
        BriefingRecipient.client_id.is_not(None), BriefingRecipient.is_active == True, in_list))).scalar_one()  # noqa: E712
    if len(ids) + clients_n > 5:
        raise HTTPException(422, "수신자는 최대 5명입니다.")
    existing = {r.user_id: r for r in (await db.execute(select(BriefingRecipient).where(
        BriefingRecipient.user_id.is_not(None), in_list))).scalars().all()}
    names = {u.id: u.nickname for u in users}
    for uid, r in existing.items():
        r.is_active = uid in ids
    for uid in ids:
        if uid not in existing:
            db.add(BriefingRecipient(user_id=uid, name=names.get(uid), is_active=True, manager_user_id=view.list_owner))
    await db.commit()
    return {"count": len(ids) + clients_n}


class SettingsBody(BaseModel):
    enabled: Optional[bool] = None
    monthly_enabled: Optional[bool] = None
    review_until: Optional[date] = None
    restart_approval: bool = False
    template_daily: Optional[str] = None
    template_monthly: Optional[str] = None
    template_report: Optional[str] = None
    weather_region: Optional[str] = None
    main_model: Optional[str] = None
    writer_model: Optional[str] = None
    review_model: Optional[str] = None
    summary_model: Optional[str] = None


def _add_business_days(start: date, n: int) -> date:
    """start 포함 평일 n일째 날짜(공휴일은 무시한 근사치)."""
    d, count = start, 0
    while True:
        if d.weekday() < 5:
            count += 1
            if count >= n:
                return d
        d += timedelta(days=1)


async def _mgr_targets(db: AsyncSession) -> list:
    from app.services.company_report import sender as _sender

    return await _sender.manager_self_targets(db, include_no_phone=True)


async def _settings_out(db: AsyncSession, user=None) -> dict:
    from app.services import settings_store
    from app.services.company_report import config as crcfg
    from app.services.company_report.keys import get_service_key

    today = today_kst()
    until = await crcfg.review_until(db)
    keys = {}
    for p in ("claude", "gemini", "naver_search", "dart", "data_go_kr", "kis"):
        keys[p] = bool(await get_service_key(db, p))
    from app.core.config import settings as app_settings

    keys["solapi"] = bool(app_settings.SOLAPI_API_KEY and app_settings.SOLAPI_API_SECRET and app_settings.SOLAPI_SENDER)
    keys["kakao_channel"] = bool(app_settings.SOLAPI_PF_ID)
    logs = (await db.execute(select(BriefingSendLog).order_by(BriefingSendLog.sent_at.desc()).limit(200 if user is not None else 20))).scalars().all()
    if user is not None:
        # 매니저: 자기 명단으로 나간 기록과 자기 테스트 발송만(다른 담당자 고객 이름·번호가 보이지 않게)
        from app.services.company_report import sender as _sender

        own = await _sender.recipient_targets(db, include_no_phone=True, list_owner=user.id)
        phones = {"".join(ch for ch in (t.phone or "") if ch.isdigit()) for t in own}
        logs = [l for l in logs if l.user_id == user.id or "".join(ch for ch in l.phone if ch.isdigit()) in phones][:20]
    # 예전 기록(이름 칸 이전)은 계정 id·휴대폰 번호로 이름을 찾는다
    from app.models.client import Client
    from app.models.user import User

    names: dict[str, str] = {}
    uids = {l.user_id for l in logs if l.user_id and not l.recipient_name}
    if uids:
        for uid, nick in (await db.execute(select(User.id, User.nickname).where(User.id.in_(uids)))).all():
            names[uid] = nick
    phones = {"".join(ch for ch in l.phone if ch.isdigit()) for l in logs if not l.recipient_name}
    if phones:
        for nm, ph in (await db.execute(select(Client.name, Client.phone).where(Client.phone.is_not(None)))).all():
            d = "".join(ch for ch in (ph or "") if ch.isdigit())
            if d in phones:
                names.setdefault(d, nm)
        for nm, ph in (await db.execute(select(User.nickname, User.phone).where(User.phone.is_not(None)))).all():
            d = "".join(ch for ch in (ph or "") if ch.isdigit())
            if d in phones:
                names.setdefault(d, nm)
    from app.services import solapi_service
    from app.services.collectors.data_go_kr import REGIONS
    from app.services.company_report import storage, usage

    try:
        balance = await solapi_service.get_balance(db) if keys["solapi"] else {"error": "SOLAPI 키 없음"}
    except Exception as e:  # 잔액 조회 실패는 화면만 비운다
        balance = {"error": str(e)[:100]}
    return {
        "ai_usage": await usage.month_usage(db),
        "ai_stages": await usage.stage_report(db),
        "solapi_balance": balance,
        "regions": list(REGIONS),
        "storage": storage.usage(),
        "enabled": await settings_store.get_bool(db, crcfg.BRIEFING_ENABLED, default=False),
        "monthly_enabled": await settings_store.get_bool(db, crcfg.MONTHLY_ENABLED, default=True),
        "review_until": until.isoformat() if until else None,
        "approval_required_today": await crcfg.approval_required(db, today),
        "approval_days_left": max(0, (until - today).days + 1) if until else None,
        "template_daily": await settings_store.get(db, crcfg.TEMPLATE_DAILY) or "",
        "template_monthly": await settings_store.get(db, crcfg.TEMPLATE_MONTHLY) or "",
        "template_report": await settings_store.get(db, crcfg.TEMPLATE_REPORT) or "",
        "weather_region": await settings_store.get(db, crcfg.WEATHER_REGION, crcfg.DEFAULT_REGION),
        "models": await crcfg.get_models(db),
        "last_run_at": await settings_store.get(db, crcfg.LAST_RUN_AT),
        "last_send_at": await settings_store.get(db, crcfg.LAST_SEND_AT),
        "cron": await cron_status.report(db),
        "manager_self": [{"name": t.name, "phone_masked": _mask_phone(t.phone), "has_phone": bool(t.phone),
                          "company_count": len(await vis.visible_company_ids(db, t.view) or [])}
                         for t in await _mgr_targets(db)],
        "keys": keys,
        "send_logs": [{
            "briefing_type": l.briefing_type, "briefing_id": l.briefing_id, "phone": l.phone[:3] + "****" + l.phone[-4:],
            "name": l.recipient_name or names.get(l.user_id or "") or names.get("".join(ch for ch in l.phone if ch.isdigit())) or None,
            "channel": l.channel, "status": l.status, "error": l.error,
            "sent_at": l.sent_at.isoformat() if l.sent_at else None,
        } for l in logs],
    }


@router.get("/costs")
async def get_costs(unit: str = Query("month", pattern="^(day|month|quarter|year)$"), current_user=Depends(get_current_user),
                    db: AsyncSession = Depends(get_db)):
    """비용 종합: 기간(일/월/분기/연)별 AI 사용액 + SOLAPI 발송비, 발송 횟수, 1회당 평균. 관리자만(발송 설정 탭)."""
    from app.services.company_report import usage

    await require_admin(db, current_user)
    return await usage.cost_history(db, unit)


@router.get("/settings")
async def get_settings(current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """발송 설정 탭 — 대표·기업 리포트 관리자만. 매니저는 탭이 없고 수신자 명단은 브리핑 탭에서 관리한다."""
    await require_admin(db, current_user)
    return await _settings_out(db)


@router.put("/settings")
async def put_settings(body: SettingsBody, current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_admin(db, current_user)
    from app.services import settings_store
    from app.services.company_report import config as crcfg

    today = today_kst()
    if body.enabled is not None:
        await settings_store.set_value(db, crcfg.BRIEFING_ENABLED, "1" if body.enabled else "0")
        # 켜면 바로 자동 발송(승인 기간 없음). 필요하면 [승인 기간 다시 시작]으로만 승인 모드
    if body.monthly_enabled is not None:
        await settings_store.set_value(db, crcfg.MONTHLY_ENABLED, "1" if body.monthly_enabled else "0")
    if body.restart_approval:
        await settings_store.set_value(db, crcfg.REVIEW_UNTIL, _add_business_days(today, crcfg.APPROVAL_DAYS).isoformat())
    elif body.review_until is not None:
        await settings_store.set_value(db, crcfg.REVIEW_UNTIL, body.review_until.isoformat())
    for field, key in (("template_daily", crcfg.TEMPLATE_DAILY), ("template_monthly", crcfg.TEMPLATE_MONTHLY),
                       ("template_report", crcfg.TEMPLATE_REPORT),
                       ("weather_region", crcfg.WEATHER_REGION), ("main_model", crcfg.MAIN_MODEL), ("writer_model", crcfg.WRITER_MODEL),
                       ("review_model", crcfg.REVIEW_MODEL), ("summary_model", crcfg.SUMMARY_MODEL)):
        v = getattr(body, field)
        if v is not None:
            await settings_store.set_value(db, key, v.strip())
    return await _settings_out(db)


@router.post("/briefings/daily/{briefing_id}/test-send")
async def test_send(briefing_id: str, recipient_id: Optional[str] = None, view: View = Depends(get_view),
                    db: AsyncSession = Depends(get_db)):
    """테스트 발송(상태 변화 없음): recipient_id가 있으면 그 수신자에게, 없으면 본인에게."""
    from app.services.company_report import sender

    r = await sender.send_test(db, briefing_id, view.user, recipient_id, view=view)
    if not r.get("success"):
        raise HTTPException(400, f"테스트 발송 실패: {r.get('error')}")
    return r


@router.post("/recipients/{recipient_id}/test-send")
async def test_send_latest(recipient_id: str, view: View = Depends(get_view), db: AsyncSession = Depends(get_db)):
    """발송 설정 화면: 가장 최근 데일리 브리핑을 이 수신자에게 테스트 발송."""
    from app.services.company_report import sender

    b = (await db.execute(select(NewsBriefing).order_by(NewsBriefing.briefing_date.desc()).limit(1))).scalars().first()
    if not b:
        raise HTTPException(404, "아직 만들어진 브리핑이 없습니다. 브리핑 탭에서 [지금 만들기]를 먼저 누르세요.")
    r = await sender.send_test(db, b.id, view.user, recipient_id, view=view)
    if not r.get("success"):
        raise HTTPException(400, f"테스트 발송 실패: {r.get('error')}")
    return r


@router.post("/briefings/daily/send-now")
async def send_now(current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """관리자: 오늘 브리핑을 지금 발송(배치와 같은 조건·중복 차단)."""
    await require_admin(db, current_user)
    from app.services.company_report import sender

    return await sender.send_daily(db)


# --------------------------------------------------------------------------- P2: 기사 아카이브(달력·기간 요약)

@router.get("/companies/{company_id}/article-dates")
async def get_article_dates(company_id: str, month: str = Query(..., pattern=r"^\d{4}-\d{2}$"),
                            current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from app.services.company_report import period

    await assert_company(db, current_user, company_id)
    return await period.article_dates(db, company_id, month)


class PeriodSummaryBody(BaseModel):
    date_from: date
    date_to: date
    refresh: bool = False


@router.post("/companies/{company_id}/period-summary")
async def post_period_summary(company_id: str, body: PeriodSummaryBody, current_user=Depends(get_current_user),
                              db: AsyncSession = Depends(get_db)):
    from app.services import llm_client
    from app.services.company_report import period

    await assert_company(db, current_user, company_id)
    if body.date_to < body.date_from or (body.date_to - body.date_from).days > 366:
        raise HTTPException(422, "기간은 1년 이내로 골라 주세요.")
    try:
        return await period.period_summary(db, company_id, body.date_from, body.date_to, current_user.id, body.refresh)
    except llm_client.LLMError as e:
        raise HTTPException(502, f"기간 요약 실패: {e}")


# --------------------------------------------------------------------------- P2: 기업 원장(사실·투자유치)

class FactBody(BaseModel):
    fact_type: str = "other"
    fact_date: Optional[date] = None
    title: str
    detail: Optional[dict] = None


class FactPatch(BaseModel):
    status: Optional[str] = None  # confirmed/rejected/candidate
    fact_type: Optional[str] = None
    fact_date: Optional[date] = None
    title: Optional[str] = None
    detail: Optional[dict] = None


@router.get("/companies/{company_id}/facts")
async def list_facts(company_id: str, status: Optional[str] = None, fact_type: Optional[str] = None,
                     include_history: bool = False, current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from app.models.company_report import CompanyFact
    from app.services.company_report import facts as facts_svc

    await assert_company(db, current_user, company_id)
    cond = [CompanyFact.company_id == company_id]
    if status:
        cond.append(CompanyFact.status == status)
    elif not include_history:
        cond.append(CompanyFact.status.in_(["candidate", "confirmed"]))
    if fact_type:
        cond.append(CompanyFact.fact_type == fact_type)
    rows = (await db.execute(select(CompanyFact).where(*cond))).scalars().all()
    counts = dict((await db.execute(
        select(CompanyFact.status, func.count()).where(CompanyFact.company_id == company_id).group_by(CompanyFact.status)
    )).all())
    return {"items": facts_svc.fact_timeline(list(rows)), "counts": counts, "types": facts_svc.FACT_TYPES}


@router.post("/companies/{company_id}/facts", status_code=201)
async def add_fact(company_id: str, body: FactBody, current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from app.models.company_report import CompanyFact
    from app.services.company_report import facts as facts_svc

    await assert_company(db, current_user, company_id, write=True)
    if body.fact_type not in facts_svc.FACT_TYPES:
        raise HTTPException(422, "알 수 없는 사실 유형입니다.")
    f = CompanyFact(company_id=company_id, fact_type=body.fact_type, fact_date=body.fact_date, title=body.title.strip()[:300],
                    detail=body.detail or {}, source_refs=[], status="confirmed", origin="manual",
                    dedup_key=facts_svc.dedup_key(company_id, body.fact_type, body.title),
                    confirmed_by=current_user.id, confirmed_at=now_kst())
    db.add(f)
    await db.flush()
    await search.index_fact(db, f)
    await db.commit()
    return facts_svc.fact_timeline([f])[0]


@router.patch("/facts/{fact_id}")
async def patch_fact(fact_id: str, body: FactPatch, background: BackgroundTasks, current_user=Depends(get_current_user),
                     db: AsyncSession = Depends(get_db)):
    from app.models.company_report import CompanyFact
    from app.services.company_report import facts as facts_svc

    f = await db.get(CompanyFact, fact_id)
    if not f:
        raise HTTPException(404, "사실을 찾을 수 없습니다.")
    await assert_company(db, current_user, f.company_id, write=True)
    changes = body.model_dump(exclude_unset=True, exclude={"status"})
    if changes:
        f = await facts_svc.edit_fact(db, f, changes, current_user.id)
    elif body.status:
        if body.status not in ("confirmed", "rejected", "candidate"):
            raise HTTPException(422, "status는 confirmed/rejected/candidate 중 하나입니다.")
        f = await facts_svc.set_status(db, f, body.status, current_user.id)
    await db.commit()
    background.add_task(_refresh_files_bg, f.company_id)
    return facts_svc.fact_timeline([f])[0]


class FundingBody(BaseModel):
    round_date: Optional[date] = None
    round_name: Optional[str] = None
    amount: Optional[int] = None
    amount_disclosed: Optional[bool] = None
    investors: Optional[list[dict]] = None
    valuation: Optional[int] = None
    is_follow_on: Optional[bool] = None
    status: Optional[str] = None


@router.get("/companies/{company_id}/funding-rounds")
async def list_funding(company_id: str, include_rejected: bool = False, current_user=Depends(get_current_user),
                       db: AsyncSession = Depends(get_db)):
    from app.models.company_report import CompanyFundingRound
    from app.services.company_report import facts as facts_svc

    await assert_company(db, current_user, company_id)
    cond = [CompanyFundingRound.company_id == company_id]
    if not include_rejected:
        cond.append(CompanyFundingRound.status != "rejected")
    rows = (await db.execute(select(CompanyFundingRound).where(*cond)
                             .order_by(CompanyFundingRound.round_date.desc().nullslast()))).scalars().all()
    return [facts_svc.funding_out(r) for r in rows]


@router.post("/companies/{company_id}/funding-rounds", status_code=201)
async def add_funding(company_id: str, body: FundingBody, current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from app.models.company_report import CompanyFundingRound
    from app.services.company_report import facts as facts_svc

    await assert_company(db, current_user, company_id, write=True)
    r = CompanyFundingRound(company_id=company_id, round_date=body.round_date, round_name=(body.round_name or "기타")[:50],
                            amount=body.amount, amount_disclosed=body.amount_disclosed if body.amount_disclosed is not None else bool(body.amount),
                            investors=body.investors or [], valuation=body.valuation, is_follow_on=bool(body.is_follow_on),
                            source_refs=[], status="confirmed", origin="manual", confirmed_by=current_user.id, confirmed_at=now_kst())
    db.add(r)
    await db.flush()
    await search.index_funding(db, r)
    await db.commit()
    return facts_svc.funding_out(r)


@router.patch("/funding-rounds/{round_id}")
async def patch_funding(round_id: str, body: FundingBody, background: BackgroundTasks, current_user=Depends(get_current_user),
                        db: AsyncSession = Depends(get_db)):
    from app.models.company_report import CompanyFundingRound
    from app.services.company_report import facts as facts_svc

    r = await db.get(CompanyFundingRound, round_id)
    if not r:
        raise HTTPException(404, "투자유치 기록을 찾을 수 없습니다.")
    await assert_company(db, current_user, r.company_id, write=True)
    data = body.model_dump(exclude_unset=True)
    status = data.pop("status", None)
    if status and status not in ("confirmed", "rejected", "candidate"):
        raise HTTPException(422, "status는 confirmed/rejected/candidate 중 하나입니다.")
    for k, v in data.items():
        setattr(r, k, v)
    if "amount" in data and "amount_disclosed" not in data:
        r.amount_disclosed = bool(r.amount)
    if status:
        r.status = status
    if status == "confirmed" or (data and r.status == "candidate"):
        r.status, r.confirmed_by, r.confirmed_at = "confirmed", current_user.id, now_kst()
    await search.index_funding(db, r)
    await db.commit()
    background.add_task(_refresh_files_bg, r.company_id)
    return facts_svc.funding_out(r)


@router.post("/companies/{company_id}/extract-facts")
async def extract_facts_now(company_id: str, background: BackgroundTasks, current_user=Depends(get_current_user),
                            db: AsyncSession = Depends(get_db)):
    """아직 사실 추출이 안 된 기사에서 후보를 다시 뽑는다(백그라운드)."""
    await assert_company(db, current_user, company_id, write=True)
    background.add_task(_run_extract, company_id)
    return {"queued": True}


async def _run_extract(company_id: str) -> None:
    from app.services.company_report import fact_verify
    from app.services.company_report import facts as facts_svc

    async with AsyncSessionLocal() as db:
        await facts_svc.extract_pending(db, company_id=company_id, limit=400)
        await fact_verify.verify_pending(db, company_id=company_id, limit=200)


@router.post("/companies/{company_id}/verify-facts")
async def verify_facts_now(company_id: str, background: BackgroundTasks, current_user=Depends(get_current_user),
                           db: AsyncSession = Depends(get_db)):
    """후보로 남은 사실을 자동 검증(원문 대조·주체 확인·출처 수·검색 교차 확인)한다(백그라운드)."""
    await assert_company(db, current_user, company_id, write=True)
    background.add_task(_run_verify, company_id)
    return {"queued": True}


async def _run_verify(company_id: str) -> None:
    from app.services.company_report import fact_verify

    async with AsyncSessionLocal() as db:
        try:
            await fact_verify.verify_pending(db, company_id=company_id, limit=200)
        except Exception:
            logger.exception("사실 자동 검증 실패")


# --------------------------------------------------------------------------- P2: 통합 검색

@router.get("/search")
async def do_search(q: str = Query(..., min_length=1, max_length=200), group: Optional[str] = None,
                    company: Optional[list[str]] = Query(None), date_from: Optional[date] = None,
                    date_to: Optional[date] = None, tag: Optional[str] = None, include_inactive: bool = True,
                    sort: str = Query("relevance", pattern="^(relevance|recent)$"),
                    page: int = Query(1, ge=1), size: int = Query(20, ge=1, le=100),
                    current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await search.search(db, q, group=group, company_ids=company, date_from=date_from, date_to=date_to, tag=tag,
                               include_inactive=include_inactive, sort=sort, page=page, size=size,
                               allowed=await vis.readable_company_ids(db, current_user))


@router.get("/search/suggest")
async def search_suggest(q: str = "", current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await search.suggest(db, q, allowed=await vis.readable_company_ids(db, current_user))


@router.post("/search/reindex")
async def search_reindex(current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_admin(db, current_user)
    return await search.reindex_all(db)


# --------------------------------------------------------------------------- P2: 기업DB(파일)

@router.get("/db/tree")
async def db_tree(current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from app.services.company_report import company_db

    return await company_db.tree(db, allowed=await vis.readable_company_ids(db, current_user))


@router.get("/db/files")
async def db_files(company: Optional[list[str]] = Query(None), portfolio: bool = False, folder: Optional[str] = None,
                   type: Optional[str] = None, origin: Optional[str] = None, status: Optional[str] = None,
                   date_from: Optional[date] = None, date_to: Optional[date] = None, q: Optional[str] = None,
                   include_inactive: bool = True, page: int = Query(1, ge=1), size: int = Query(50, ge=1, le=200),
                   current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from app.services.company_report import company_db

    return await company_db.list_files(db, company_ids=company, portfolio=portfolio, folder=folder, file_type=type,
                                       origin=origin, status=status, date_from=date_from, date_to=date_to, q=q,
                                       include_inactive=include_inactive, page=page, size=size,
                                       allowed=await vis.readable_company_ids(db, current_user))


@router.post("/db/files", status_code=201)
async def db_upload(background: BackgroundTasks, file: UploadFile = File(...), company_id: Optional[str] = Form(None),
                    folder: str = Form("docs"), doc_kind: Optional[str] = Form(None), memo: Optional[str] = Form(None),
                    current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """업로드 — 파일명 규칙에 맞게 자동으로 이름이 바뀐다(원래 이름은 따로 보관).
    03_자료에 올린 문서는 자료함에 등록하고 뒤에서 읽는다(반기 보고서 재료, P4-2)."""
    from app.services.company_report import company_db, documents

    if company_id:
        await assert_company(db, current_user, company_id, write=True)
    from app.core.uploads import read_limited

    data = await read_limited(file, company_db.MAX_UPLOAD, "파일")  # 한도 넘으면 다 읽기 전에 413(수정_tasks P2-13)
    try:
        f = await company_db.upload_file(db, company_id=company_id or None, folder=folder, filename=file.filename or "file",
                                         data=data, user_id=current_user.id, doc_kind=(doc_kind or None), memo=memo)
    except ValueError as e:
        raise HTTPException(422, str(e))
    doc = await documents.register(db, f, current_user.id)
    await db.commit()
    await db.refresh(f)
    if doc:
        background.add_task(documents.process_in_background, doc.id)
    return company_db.file_out(f)


# --------------------------------------------------------------------------- 자료함 (P4-2)

@router.get("/companies/{company_id}/documents")
async def list_documents(company_id: str, background: BackgroundTasks, current_user=Depends(get_current_user),
                         db: AsyncSession = Depends(get_db)):
    """기업 자료함: 03_자료 문서를 읽은 결과. 예전에 올린 파일도 처음 열 때 등록해 읽는다."""
    from app.models.company_report import CompanyDocument, CompanyFile
    from app.services.company_report import documents

    await assert_company(db, current_user, company_id)
    new_ids = await documents.sync_company(db, company_id)
    if new_ids:
        await db.commit()
        for i in new_ids:
            background.add_task(documents.process_in_background, i)
    rows = (await db.execute(
        select(CompanyDocument, CompanyFile).join(CompanyFile, CompanyFile.id == CompanyDocument.file_id)
        .where(CompanyDocument.company_id == company_id, CompanyFile.status != "deleted")
        .order_by(CompanyDocument.created_at.desc())
    )).all()
    return {"items": [documents.doc_out(d, f) for d, f in rows], "doc_types": documents.DOC_TYPES,
            "can_edit": await vis.can_edit(db, current_user, await db.get(PortfolioCompany, company_id))}


async def _doc_for(db: AsyncSession, user, doc_id: str, write: bool = False):
    from app.models.company_report import CompanyDocument

    d = await db.get(CompanyDocument, doc_id)
    if not d:
        raise HTTPException(404, "자료를 찾을 수 없습니다.")
    await assert_company(db, user, d.company_id, write=write)
    return d


class DocumentPatch(BaseModel):
    use_in_report: Optional[bool] = None
    is_public: Optional[bool] = None
    doc_type: Optional[str] = None
    ai_memo: Optional[str] = Field(None, max_length=1500)
    doc_date: Optional[date] = None  # 자료 날짜(담당자가 고침). null 이면 지움 → 올린 날 기준


@router.patch("/documents/{doc_id}")
async def patch_document(doc_id: str, body: DocumentPatch, current_user=Depends(get_current_user),
                         db: AsyncSession = Depends(get_db)):
    """보고서에 쓸지·공개 자료인지·종류·메모 고치기."""
    from app.models.company_report import CompanyFile
    from app.services.company_report import documents

    d = await _doc_for(db, current_user, doc_id, write=True)
    data = body.model_dump(exclude_unset=True)
    if "doc_type" in data and data["doc_type"] not in documents.DOC_TYPES:
        raise HTTPException(422, "자료 종류가 올바르지 않습니다.")
    if "doc_date" in data:
        if data["doc_date"] and data["doc_date"] > today_kst():
            raise HTTPException(422, "자료 날짜는 오늘 이후로 정할 수 없습니다.")
        d.doc_date_source = "manual" if data["doc_date"] else None
    for k, v in data.items():
        setattr(d, k, v)
    await db.commit()
    await db.refresh(d)
    return documents.doc_out(d, await db.get(CompanyFile, d.file_id))


@router.post("/documents/{doc_id}/reparse")
async def reparse_document(doc_id: str, background: BackgroundTasks, current_user=Depends(get_current_user),
                           db: AsyncSession = Depends(get_db)):
    """다시 읽기(파일을 바꿔 올렸거나 AI 메모가 비었을 때)."""
    from app.services.company_report import documents

    d = await _doc_for(db, current_user, doc_id, write=True)
    d.extract_status, d.extract_error = "pending", None
    await db.commit()
    background.add_task(documents.process_in_background, d.id)
    return {"id": d.id, "extract_status": "pending"}


@router.get("/documents/{doc_id}/text")
async def document_text(doc_id: str, current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """읽어 낸 글 미리보기."""
    d = await _doc_for(db, current_user, doc_id)
    return {"id": d.id, "filename": d.filename, "text": d.extracted_text or "", "images": [
        {"index": i, "page": im.get("page"), "width": im.get("width"), "height": im.get("height")}
        for i, im in enumerate(d.extracted_images or [])]}


@router.get("/documents/{doc_id}/images/{index}")
async def document_image(doc_id: str, index: int, current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """자료에서 꺼낸 그림(보고서 이미지 후보)."""
    from fastapi.responses import Response

    from app.services.company_report import company_db, storage

    d = await _doc_for(db, current_user, doc_id)
    imgs = d.extracted_images or []
    if index < 0 or index >= len(imgs):
        raise HTTPException(404, "그림을 찾을 수 없습니다.")
    im = imgs[index]
    try:
        data = storage.read_bytes(im["key"])
    except Exception:
        raise HTTPException(404, "그림 파일이 없습니다.")
    return Response(content=data, media_type=company_db.MIME.get(im.get("ext") or "png", "application/octet-stream"),
                    headers={"Cache-Control": "private, max-age=3600"})


class FilePatch(BaseModel):
    memo: Optional[str] = None
    doc_kind: Optional[str] = None
    deleted: Optional[bool] = None


@router.patch("/db/files/{file_id}")
async def db_patch_file(file_id: str, body: FilePatch, current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from app.models.company_report import CompanyFile
    from app.services.company_report import company_db

    f = await db.get(CompanyFile, file_id)
    if not f or f.status == "deleted":
        raise HTTPException(404, "파일을 찾을 수 없습니다.")
    if f.company_id:
        await assert_company(db, current_user, f.company_id)
    if body.deleted:
        # 삭제는 올린 사람 또는 관리자만, 자동 파일은 삭제하지 않는다(파일은 남기고 목록에서만 뺀다)
        if f.origin == "auto":
            raise HTTPException(400, "자동으로 만들어지는 파일은 지울 수 없습니다.")
        from app.services.company_report import admin as cr_admin

        if f.created_by != current_user.id and not await cr_admin.is_admin(db, current_user):
            raise HTTPException(403, "올린 사람 또는 관리자만 지울 수 있습니다.")
        f.status = "deleted"
    if body.memo is not None:
        f.memo = body.memo
    if body.doc_kind is not None and f.origin == "upload":
        cname = (await db.get(PortfolioCompany, f.company_id)).name if f.company_id else None
        stem = company_db.split_ext(f.original_name or "")[0]
        f.doc_kind = body.doc_kind.strip()[:40] or f.doc_kind
        f.display_name = company_db.display_name(cname, f.doc_kind, f.period_label, f.version, f.file_type, extra=stem)
    cname = (await db.get(PortfolioCompany, f.company_id)).name if f.company_id else None
    await search.index_file(db, f, cname)
    await db.commit()
    await db.refresh(f)
    return company_db.file_out(f, cname)


@router.get("/db/files/{file_id}/download")
async def db_download(file_id: str, inline: bool = False, current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from urllib.parse import quote

    from fastapi.responses import FileResponse

    from app.models.company_report import CompanyFile
    from app.services.company_report import company_db, storage

    f = await db.get(CompanyFile, file_id)
    if not f or f.status == "deleted" or not storage.exists(f.storage_key):
        raise HTTPException(404, "파일을 찾을 수 없습니다.")
    if f.company_id:
        await assert_company(db, current_user, f.company_id)
    await company_db.log_download(db, file_id=f.id, company_id=f.company_id, user_id=current_user.id)
    disp = "inline" if inline else "attachment"
    return FileResponse(storage.path_of(f.storage_key), media_type=f.mime or "application/octet-stream",
                        headers={"Content-Disposition": f"{disp}; filename*=UTF-8''{quote(f.display_name)}"})


@router.get("/db/companies/{company_id}/zip")
async def db_zip(company_id: str, current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """기업 폴더 통째로 내려받기. company_id=_portfolio 이면 '_포트폴리오 공통'."""
    from urllib.parse import quote

    from fastapi.responses import Response

    from app.services.company_report import company_db

    cid = None if company_id == "_portfolio" else company_id
    if cid:
        await assert_company(db, current_user, cid)
    data, name = await company_db.zip_company(db, cid)
    await company_db.log_download(db, file_id=None, company_id=cid, user_id=current_user.id, kind="zip")
    return Response(content=data, media_type="application/zip",
                    headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(name)}"})


@router.post("/db/companies/{company_id}/refresh")
async def db_refresh(company_id: str, current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """자동 파일(월별 뉴스 모음·사실 원장·투자유치 엑셀·기업카드) 지금 다시 만들기."""
    from app.services.company_report import company_db

    await assert_company(db, current_user, company_id)
    return await company_db.refresh_auto_files(db, company_id)


async def _refresh_files_bg(company_id: str) -> None:
    from app.services.company_report import company_db

    async with AsyncSessionLocal() as db:
        try:
            await company_db.refresh_auto_files(db, company_id)
        except Exception:
            logger.exception("자동 파일 갱신 실패")


# --------------------------------------------------------------------------- P2: 공공데이터

@router.get("/companies/{company_id}/public-data")
async def get_public_data(company_id: str, current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from app.services.company_report import public_data

    await assert_company(db, current_user, company_id)
    return await public_data.company_public_data(db, company_id)


@router.post("/companies/{company_id}/public-data/refresh")
async def refresh_public_data(company_id: str, current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from app.services.company_report import public_data

    c = await assert_company(db, current_user, company_id)
    result = await public_data.snapshot_company(db, c)
    return {"result": result, **(await public_data.company_public_data(db, company_id))}


# --------------------------------------------------------------------------- 투자기업 2단계 삭제

@router.post("/companies/{company_id}/trash")
async def trash_company(company_id: str, current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """1단계 · 화면에서 삭제: 목록·검색·수집에서 빠진다. 데이터·폴더는 남고 복구할 수 있다.
    매니저는 '내 목록에서 빼기' — 마지막 한 명이 빼면 화면에서 삭제된다(대표가 [삭제된 기업]에서 복구 가능)."""
    from app.services.company_report import company_delete

    c = await assert_company(db, current_user, company_id)
    if not await vis.can_manage_all(db, current_user):
        left = await vis.remove_member(db, c.id, current_user.id)
        if left == 0:  # 추가했던 사람이 모두 뺐을 때만 목록에서 빠진다(폴더는 그대로 — 완전 삭제는 대표가 따로)
            try:
                await company_delete.trash(db, c, current_user.id, reason="all_removed")
            except company_delete.DeleteError:
                pass  # 구축 중이면 목록에서만 빠진다(수집은 다음 정리 때)
        await db.commit()
        return {"id": c.id, "name": c.name, "removed_from_list": True}
    try:
        await company_delete.trash(db, c, current_user.id)
    except company_delete.DeleteError as e:
        raise HTTPException(409, str(e))
    await db.commit()
    return {"id": c.id, "name": c.name, "deleted_at": c.deleted_at.isoformat()}


@router.post("/companies/{company_id}/restore")
async def restore_company(company_id: str, current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from app.services.company_report import company_delete

    c = await vis.assert_company_admin(db, current_user, company_id)
    dup = (await db.execute(select(PortfolioCompany.id).where(
        PortfolioCompany.name == c.name, PortfolioCompany.id != c.id, PortfolioCompany.deleted_at.is_(None)))).first()
    if dup:
        raise HTTPException(409, "같은 이름의 기업이 이미 목록에 있어 복구할 수 없습니다.")
    r = await company_delete.restore(db, c)
    await db.commit()
    return {"id": c.id, "name": c.name, **r}


@router.get("/companies/{company_id}/purge-summary")
async def purge_summary(company_id: str, current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """2단계 전에 지워질 데이터 건수·파일 용량."""
    from app.services.company_report import company_delete

    c = await vis.assert_company_admin(db, current_user, company_id)
    return {"name": c.name, "trashed": bool(c.deleted_at), **(await company_delete.summary(db, company_id))}


class PurgeBody(BaseModel):
    confirm_name: str


@router.post("/companies/{company_id}/purge")
async def purge_company(company_id: str, body: PurgeBody, current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """2단계 · 폴더까지 완전 삭제(관리자). 1단계로 지운 기업만, 기업명을 정확히 입력해야 한다. 되돌릴 수 없다."""
    from app.services.company_report import company_delete

    await require_admin(db, current_user)
    c = await db.get(PortfolioCompany, company_id)
    if not c:
        raise HTTPException(404, "기업을 찾을 수 없습니다.")
    try:
        return await company_delete.purge(db, c, body.confirm_name, current_user.id)
    except company_delete.DeleteError as e:
        raise HTTPException(409, str(e))


# --------------------------------------------------------------------------- 반기 보고서 (P4-5)

class ReportCreate(BaseModel):
    year: Optional[int] = Field(None, ge=2000, le=2100)
    half: Optional[int] = Field(None, ge=1, le=2)


def _report_brief(r, names: dict) -> dict:
    from app.services.company_report.half_year import half_label

    return {"id": r.id, "company_id": r.company_id, "period_year": r.period_year, "period_half": r.period_half,
            "period_label": half_label(r.period_year, r.period_half), "version": r.version, "status": r.status,
            "progress": r.progress, "progress_step": r.progress_step, "owner_user_id": r.owner_user_id,
            "owner_name": names.get(r.owner_user_id or ""), "base_report_id": r.base_report_id, "error": r.error,
            "as_of_date": r.as_of_date.isoformat() if r.as_of_date else None,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "updated_at": r.updated_at.isoformat() if r.updated_at else None,
            "official": bool(getattr(r, "official", False)) and r.status == "final",
            "review_summary": (r.review or {}).get("summary")}


async def _user_names(db: AsyncSession, ids) -> dict[str, str]:
    from app.models.user import User

    ids = [i for i in set(ids) if i]
    if not ids:
        return {}
    return dict((await db.execute(select(User.id, User.nickname).where(User.id.in_(ids)))).all())


async def _report_for(db: AsyncSession, user, report_id: str):
    """보고서 읽기 권한: 그 기업을 볼 수 있어야 하고, 남이 고친 개인 버전은 본인·대표만(공식본은 모두)."""
    from app.models.company_report import CompanyReport
    from app.services.company_report import report_hub

    r = await db.get(CompanyReport, report_id)
    if not r:
        raise HTTPException(404, "보고서를 찾을 수 없습니다.")
    await assert_company(db, user, r.company_id)
    if not report_hub.can_read(r, user):
        raise HTTPException(404, "보고서를 찾을 수 없습니다.")
    return r


@router.post("/companies/{company_id}/reports", status_code=202)
async def create_half_year_report(company_id: str, body: ReportCreate, background: BackgroundTasks,
                                  current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """반기 보고서 자동 생성본을 새로 만든다(백그라운드 수 분). 반기를 안 주면 가장 최근에 끝난 반기.
    그 기업을 목록에 둔 사람(매니저)과 대표가 만들 수 있다 — 승인 없이 매니저가 독립적으로 쓴다."""
    from app.models.company_report import CompanyReport
    from app.services.company_report import half_year

    await assert_company(db, current_user, company_id)
    if (body.year is None) != (body.half is None):
        raise HTTPException(422, "연도와 반기를 함께 고르세요.")
    year, half = (body.year, body.half) if body.year else half_year.latest_closed_half()
    start, _ = half_year.half_range(year, half)
    if start > today_kst():
        raise HTTPException(422, "아직 시작하지 않은 반기입니다.")
    from app.services.company_report import report_jobs

    running = (await db.execute(select(CompanyReport.id).where(
        CompanyReport.company_id == company_id, CompanyReport.period_year == year, CompanyReport.period_half == half,
        CompanyReport.owner_user_id.is_(None), CompanyReport.status == "generating",
        CompanyReport.progress_step != report_jobs.QUEUED,
        CompanyReport.created_at > func.now() - timedelta(hours=2)))).first()  # created_at 은 DB 시계(server_default)
    if running:
        raise HTTPException(409, "이 반기 보고서를 이미 만들고 있습니다. 끝날 때까지 기다려 주세요.")

    queued = (await db.execute(select(CompanyReport).where(
        CompanyReport.company_id == company_id, CompanyReport.period_year == year, CompanyReport.period_half == half,
        CompanyReport.owner_user_id.is_(None), CompanyReport.status == "generating",
        CompanyReport.progress_step == report_jobs.QUEUED))).scalars().first()
    if queued:  # 자동 예약(1/31·7/31)된 것이 아직 차례를 기다리면 지금 바로 시작
        queued.progress_step, queued.created_by = "대기", current_user.id
        await db.commit()
        await db.refresh(queued)
        background.add_task(half_year.run_in_background, queued.id)
        return _report_brief(queued, {})
    r = await half_year.create_report(db, company_id, year, half, current_user.id)
    background.add_task(half_year.run_in_background, r.id)
    return _report_brief(r, {})


@router.get("/companies/{company_id}/reports")
async def list_half_year_reports(company_id: str, current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """이 기업의 보고서 버전 목록(최신 반기·최신 버전 먼저). 남이 고친 개인 버전은 본인·대표만 본다(공식본은 모두)."""
    from app.models.company_report import CompanyReport
    from app.services.company_report import report_hub

    await assert_company(db, current_user, company_id)
    stmt = select(CompanyReport).where(CompanyReport.company_id == company_id)
    rows = (await db.execute(stmt.order_by(CompanyReport.period_year.desc(), CompanyReport.period_half.desc(),
                                           CompanyReport.created_at.desc()))).scalars().all()
    rows = [r for r in rows if report_hub.can_read(r, current_user)]
    names = await _user_names(db, [r.owner_user_id for r in rows])
    return [_report_brief(r, names) for r in rows]


async def _report_detail(db: AsyncSession, r, user) -> dict:
    from app.models.company_report import ReportImage
    from app.services.company_report import report_edit, report_hub

    imgs = (await db.execute(select(ReportImage).where(ReportImage.report_id == r.id).order_by(ReportImage.sort_order))).scalars().all()
    names = await _user_names(db, [r.owner_user_id, r.finalized_by])
    return {**_report_brief(r, names), "content": r.content, "sources": r.sources, "review": r.review,
            "sales_note": r.sales_note, "token_usage": r.token_usage, "main_model": r.main_model, "review_model": r.review_model,
            "mine": r.owner_user_id == user.id, "disputed_count": report_edit.disputed_count(r.content or {}),
            "can_send": report_hub.can_send(r, user),
            "finalized_by_name": names.get(r.finalized_by or ""),
            "finalized_at": r.finalized_at.isoformat() if r.finalized_at else None,
            "images": [{"id": i.id, "section_no": i.section_no, "kind": i.kind, "caption": i.caption,
                        "source_label": i.source_label, "rights_note": i.rights_note, "width": i.width, "height": i.height,
                        "sort_order": i.sort_order, "selected": i.selected} for i in imgs]}


@router.get("/reports/{report_id}")
async def get_half_year_report(report_id: str, current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """보고서 본문·출처·검토 결과·이미지·영업 노트."""
    r = await _report_for(db, current_user, report_id)
    return await _report_detail(db, r, current_user)


@router.get("/report-images/{image_id}/file")
async def report_image_file(image_id: str, current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from fastapi.responses import Response

    from app.models.company_report import ReportImage
    from app.services.company_report import company_db, storage

    im = await db.get(ReportImage, image_id)
    if not im:
        raise HTTPException(404, "그림을 찾을 수 없습니다.")
    await _report_for(db, current_user, im.report_id)
    try:
        data = storage.read_bytes(im.storage_key)
    except Exception:
        raise HTTPException(404, "그림 파일이 없습니다.")
    ext = im.storage_key.rsplit(".", 1)[-1].lower()
    return Response(content=data, media_type=company_db.MIME.get(ext, "image/png"), headers={"Cache-Control": "private, max-age=3600"})


# --------------------------------------------------------------------------- 반기 보고서 편집·검토 완료 (P4-9)

class ItemEdit(BaseModel):
    text: Optional[str] = Field(None, max_length=600)
    cells: Optional[list[str]] = Field(None, max_length=8)
    delete: bool = False
    resolve: bool = False


class ImagePatch(BaseModel):
    selected: Optional[bool] = None
    caption: Optional[str] = Field(None, max_length=300)
    section_no: Optional[int] = Field(None, ge=1, le=10)
    sort_order: Optional[int] = Field(None, ge=0, le=10000)


@router.patch("/reports/{report_id}/items/{item_id}")
async def edit_report_item(report_id: str, item_id: str, body: ItemEdit, current_user=Depends(get_current_user),
                           db: AsyncSession = Depends(get_db)):
    """문장·표 행 고치기/지우기/'확인했음'. 공용본이나 검토 완료본을 고치면 내 버전이 새로 생긴다(응답의 id 가 바뀜)."""
    import copy

    from app.services.company_report import report_edit

    if body.text is None and body.cells is None and not body.delete and not body.resolve:
        raise HTTPException(422, "바꿀 내용이 없습니다.")
    r = await _report_for(db, current_user, report_id)
    mine = await report_edit.own_copy(db, r, current_user.id)
    content = copy.deepcopy(mine.content)
    report_edit.edit_item(content, item_id, text=body.text, cells=body.cells, delete=body.delete, resolve=body.resolve)
    mine.content = content  # JSONB 는 통째로 바꿔야 저장된다
    await db.commit()
    await db.refresh(mine)
    return await _report_detail(db, mine, current_user)


@router.patch("/reports/{report_id}/images/{image_id}")
async def edit_report_image(report_id: str, image_id: str, body: ImagePatch, current_user=Depends(get_current_user),
                            db: AsyncSession = Depends(get_db)):
    """그림 넣기/빼기·설명 고치기·항목 옮기기(내 버전에서)."""
    from app.services.company_report import report_edit

    r = await _report_for(db, current_user, report_id)
    from app.models.company_report import ReportImage

    src = await db.get(ReportImage, image_id)
    if src is None or src.report_id != r.id:
        raise HTTPException(404, "그림을 찾을 수 없습니다.")
    mine = await report_edit.own_copy(db, r, current_user.id)
    iid = await report_edit.copy_image_id(db, image_id, mine)
    await report_edit.set_image(db, mine, iid, selected=body.selected, caption=body.caption, section_no=body.section_no,
                                sort_order=body.sort_order)
    await db.commit()
    await db.refresh(mine)
    return await _report_detail(db, mine, current_user)


@router.post("/reports/{report_id}/finalize")
async def finalize_report(report_id: str, current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """[검토 완료] — 승인 절차 없이 본인이 확정한다(2026-10-01 결정). 확인 필요 문장이 남아 있어도 막지 않고 개수만 알려 준다."""
    from app.services.company_report import report_edit

    r = await _report_for(db, current_user, report_id)
    if r.status == "final" and r.owner_user_id == current_user.id:
        raise HTTPException(409, "이미 검토 완료한 버전입니다.")
    mine, warnings = await report_edit.finalize(db, r, current_user.id)
    await db.commit()
    await db.refresh(mine)
    return {"report": await _report_detail(db, mine, current_user), "warnings": warnings}


# --------------------------------------------------------------------------- 출력·발송 (P4-7·P4-10)

def _file_response(data: bytes, name: str, mime: str):
    from urllib.parse import quote

    from fastapi.responses import Response

    return Response(content=data, media_type=mime, headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(name)}"})


@router.get("/reports/{report_id}/export")
async def export_report(report_id: str, format: str = Query("pdf", pattern="^(pdf|docx)$"), client_id: Optional[str] = None,
                        current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """PDF·DOCX 내려받기. client_id 를 주면 표지에 고객 이름, 쪽 아래에 그 고객 담당 매니저 연락처(내 고객만)."""
    from app.core.permissions import assert_client
    from app.services.company_report import exporters

    r = await _report_for(db, current_user, report_id)
    if client_id:
        await assert_client(db, current_user, client_id)
    try:
        data, name, mime = await exporters.export(db, r, format, user_id=current_user.id, client_id=client_id)
    except ValueError as e:
        raise HTTPException(409, str(e))
    return _file_response(data, name, mime)


@router.get("/report-send/clients")
async def report_send_clients(report_id: Optional[str] = None, q: str = Query("", max_length=50),
                              current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """보고서를 보낼 수 있는 고객(매니저는 자기 담당 고객만). report_id 를 주면 이미 보낸 고객 표시."""
    from app.core.permissions import scope_clients
    from app.models.client import Client
    from app.models.company_report import ReportExport

    stmt = scope_clients(select(Client), current_user)
    if q.strip():
        stmt = stmt.where(Client.name.contains(q.strip()))
    rows = (await db.execute(stmt.order_by(Client.name).limit(500))).scalars().all()
    sent: dict[str, str] = {}
    if report_id:
        r = await _report_for(db, current_user, report_id)
        for cid, at in (await db.execute(select(ReportExport.client_id, ReportExport.exported_at).where(
                ReportExport.report_id == r.id, ReportExport.format == "link"))).all():
            if cid:
                sent[cid] = at.isoformat() if at else ""
    names = await _user_names(db, [c.user_id for c in rows])

    def mask(p: Optional[str]) -> Optional[str]:
        d = "".join(ch for ch in (p or "") if ch.isdigit())
        return f"{d[:3]}-****-{d[-4:]}" if len(d) >= 10 else None

    return [{"id": c.id, "name": c.name, "phone_masked": mask(c.phone), "has_phone": bool(c.phone),
             "manager_name": names.get(c.user_id or ""), "sent_at": sent.get(c.id)} for c in rows]


class ReportSendBody(BaseModel):
    client_ids: list[str] = Field(..., min_length=1, max_length=200)


@router.post("/reports/{report_id}/send")
async def send_report(report_id: str, body: ReportSendBody, request: Request,
                      current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """고객에게 카톡(알림톡 템플릿 승인 전에는 문자) 링크 발송. 검토 완료된 내 보고서 또는 공식본만, 내 담당 고객에게만."""
    from app.core.permissions import assert_client, forbid_while_impersonating
    from app.services.company_report import report_hub, report_share

    ctx = getattr(request.state, "auth_ctx", None)
    if ctx is not None:
        forbid_while_impersonating(ctx)
    r = await _report_for(db, current_user, report_id)
    if r.status != "final":
        raise HTTPException(409, "검토 완료한 보고서만 고객에게 보낼 수 있습니다. 먼저 [검토 완료]를 눌러 주세요.")
    if not report_hub.can_send(r, current_user):
        raise HTTPException(403, "본인이 검토 완료한 보고서나 검토 담당이 완료한 공식본만 보낼 수 있습니다.")
    clients = []
    for cid in dict.fromkeys(body.client_ids):
        clients.append(await assert_client(db, current_user, cid))
    return await report_share.send(db, r, clients, current_user)


@router.get("/reports/{report_id}/exports")
async def report_export_history(report_id: str, current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    r = await _report_for(db, current_user, report_id)
    return await _export_rows(db, current_user, [r.id])


async def _export_rows(db: AsyncSession, user, report_ids: Optional[list[str]] = None, limit: int = 300) -> list[dict]:
    """출력·발송 기록. 고객 이름은 그 고객을 볼 수 있는 사람에게만 보인다."""
    from app.core.permissions import client_ids_subquery
    from app.models.client import Client
    from app.models.company_report import CompanyReport, ReportExport
    from app.services.company_report.half_year import half_label

    stmt = (select(ReportExport, CompanyReport, PortfolioCompany.name)
            .join(CompanyReport, CompanyReport.id == ReportExport.report_id)
            .join(PortfolioCompany, PortfolioCompany.id == CompanyReport.company_id))
    if report_ids is not None:
        stmt = stmt.where(ReportExport.report_id.in_(report_ids))
    ids = await vis.readable_company_ids(db, user)
    if ids is not None:
        stmt = stmt.where(CompanyReport.company_id.in_(ids), ReportExport.exported_by == user.id)
    rows = (await db.execute(stmt.order_by(ReportExport.exported_at.desc()).limit(limit))).all()
    cids = {e.client_id for e, _, _ in rows if e.client_id}
    sub = client_ids_subquery(user)
    cstmt = select(Client.id, Client.name).where(Client.id.in_(cids))
    if sub is not None:
        cstmt = cstmt.where(Client.id.in_(sub))
    cnames = dict((await db.execute(cstmt)).all()) if cids else {}
    unames = await _user_names(db, [e.exported_by for e, _, _ in rows])
    return [{"id": e.id, "report_id": e.report_id, "version": e.version, "format": e.format, "company_name": cname,
             "period_label": half_label(r.period_year, r.period_half), "client_name": cnames.get(e.client_id or ""),
             "for_client": bool(e.client_id), "file_id": e.file_id, "exported_by_name": unames.get(e.exported_by or ""),
             "exported_at": e.exported_at.isoformat() if e.exported_at else None} for e, r, cname in rows]


# --------------------------------------------------------------------------- 보고서 관리 화면 (P4-10) · 연동 API (P4-8)

def _half_or_latest(year: Optional[int], half: Optional[int]) -> tuple[int, int]:
    from app.services.company_report import half_year

    if (year is None) != (half is None):
        raise HTTPException(422, "연도와 반기를 함께 주세요.")
    return (year, half) if year else half_year.latest_closed_half()


@router.get("/reports-overview")
async def reports_overview(year: Optional[int] = Query(None, ge=2000, le=2100), half: Optional[int] = Query(None, ge=1, le=2),
                           view: View = Depends(get_view), current_user=Depends(get_current_user),
                           db: AsyncSession = Depends(get_db)):
    """반기별 진행 현황: 지금 보는 목록(내 기업 / 대표는 전체·매니저별)의 기업마다 보고서 단계."""
    from app.services.company_report import doc_requests, report_hub
    from app.services.company_report.half_year import half_label

    y, h = _half_or_latest(year, half)
    ids = await vis.visible_company_ids(db, view)
    if ids is None:
        ids = set((await db.execute(select(PortfolioCompany.id).where(PortfolioCompany.deleted_at.is_(None)))).scalars().all())
    rows = await report_hub.overview(db, current_user, list(ids), y, h)
    names = await _user_names(db, [o["owner_user_id"] for row in rows for o in row["others"]]
                              + [row["official"]["by_user_id"] for row in rows if row["official"]])
    for row in rows:
        for o in row["others"]:
            o["owner_name"] = names.get(o["owner_user_id"])
        if row["official"]:
            row["official"]["by_name"] = names.get(row["official"]["by_user_id"] or "")
    counts: dict[str, int] = {}
    for row in rows:
        counts[row["stage"]] = counts.get(row["stage"], 0) + 1
    dy, dh = doc_requests.target_half()
    return {"year": y, "half": h, "period_label": half_label(y, h), "companies": rows, "counts": counts,
            "doc_season": doc_requests.in_request_season(), "doc_period": {"year": dy, "half": dh, "label": half_label(dy, dh)}}


class ReviewersBody(BaseModel):
    user_ids: list[str] = Field(default_factory=list, max_length=20)


@router.put("/companies/{company_id}/report-reviewers")
async def set_report_reviewers(company_id: str, body: ReviewersBody, request: Request,
                               current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """반기 보고서 검토 담당 지정(대표 전용, 2026-10-08). 빈 목록이면 지정 해제.
    검토 담당이 [검토 완료]한 버전이 공식본이 되고, 매주 월요일 검토 요청 알림은 검토 담당에게만 간다."""
    from app.core.permissions import forbid_while_impersonating, is_owner

    ctx = getattr(request.state, "auth_ctx", None)
    if ctx is not None:
        forbid_while_impersonating(ctx)
    if not is_owner(current_user):
        raise HTTPException(403, "검토 담당은 대표만 정할 수 있습니다.")
    await assert_company(db, current_user, company_id)
    await vis.set_reviewers(db, company_id, body.user_ids)
    await db.commit()
    members = (await vis.member_names(db, [company_id])).get(company_id, [])
    return {"company_id": company_id, "members": members, "reviewers": [m for m in members if m["reviewer"]]}


@router.get("/report-exports")
async def report_exports(current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """출력·발송 기록(최근 300건). 매니저는 본인 기록만, 대표는 전체."""
    return await _export_rows(db, current_user)


class ExportBatchBody(BaseModel):
    company_ids: list[str] = Field(..., min_length=1, max_length=100)
    year: int = Field(..., ge=2000, le=2100)
    half: int = Field(..., ge=1, le=2)
    format: str = Field("pdf", pattern="^(pdf|docx)$")


@router.post("/reports/export-batch")
async def export_batch(body: ExportBatchBody, current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """여러 기업 보고서를 zip 하나로(기업마다 '지금 쓸 보고서'). 완성본이 없는 기업은 zip 안 _빠진_기업.txt 에 적는다."""
    from app.services.company_report import report_hub

    ids = list(dict.fromkeys(body.company_ids))
    await vis.assert_company_ids(db, current_user, ids)
    data, name, skipped = await report_hub.batch_zip(db, current_user, ids, body.year, body.half, body.format)
    if len(skipped) == len(ids):
        raise HTTPException(409, "고른 기업 중 완성된 보고서가 있는 곳이 없습니다.")
    return _file_response(data, name, "application/zip")


@router.get("/companies/{company_id}/report-content")
async def report_content(company_id: str, year: Optional[int] = Query(None, ge=2000, le=2100),
                         half: Optional[int] = Query(None, ge=1, le=2), current_user=Depends(get_current_user),
                         db: AsyncSession = Depends(get_db)):
    """고객자산관리 종합 보고서 연동용: 이 기업의 그 반기 보고서 요약(내부 표시 뺌). 반기를 안 주면 가장 최근 완성본."""
    from app.models.company_report import CompanyReport
    from app.services.company_report import report_hub

    await assert_company(db, current_user, company_id)
    stmt = select(CompanyReport).where(CompanyReport.company_id == company_id, CompanyReport.status.in_(report_hub.READY))
    if year is not None or half is not None:
        y, h = _half_or_latest(year, half)
        stmt = stmt.where(CompanyReport.period_year == y, CompanyReport.period_half == h)
    rows = (await db.execute(stmt)).scalars().all()
    if not rows:
        return {"available": False}
    latest = max((r.period_year, r.period_half) for r in rows)
    p = report_hub.pick([r for r in rows if (r.period_year, r.period_half) == latest], current_user.id)
    if p is None:
        return {"available": False}
    return {"available": True, **report_hub.content_view(p)}


# --------------------------------------------------------------------------- 자료 요청 체크리스트 (P4-4)

class DocRequestPatch(BaseModel):
    key: str = Field(..., max_length=30)
    done: Optional[bool] = None
    note: Optional[str] = Field(None, max_length=300)


@router.get("/companies/{company_id}/doc-requests")
async def get_doc_requests(company_id: str, year: Optional[int] = Query(None, ge=2000, le=2100),
                           half: Optional[int] = Query(None, ge=1, le=2), current_user=Depends(get_current_user),
                           db: AsyncSession = Depends(get_db)):
    from app.services.company_report import doc_requests

    await assert_company(db, current_user, company_id)
    if (year is None) != (half is None):
        raise HTTPException(422, "연도와 반기를 함께 주세요.")
    y, h = (year, half) if year else doc_requests.target_half()
    return await doc_requests.checklist(db, company_id, y, h)


@router.patch("/companies/{company_id}/doc-requests")
async def patch_doc_requests(company_id: str, body: DocRequestPatch, year: int = Query(..., ge=2000, le=2100),
                             half: int = Query(..., ge=1, le=2), current_user=Depends(get_current_user),
                             db: AsyncSession = Depends(get_db)):
    from app.services.company_report import doc_requests

    await assert_company(db, current_user, company_id)
    try:
        return await doc_requests.mark(db, company_id, year, half, body.key, done=body.done, note=body.note,
                                       user_id=current_user.id)
    except ValueError as e:
        raise HTTPException(422, str(e))


# --------------------------------------------------------------------------- 고객용 폰 화면 (로그인 없음)

async def _public_report(db: AsyncSession, t: str):
    from app.models.client import Client
    from app.models.company_report import CompanyReport
    from app.services.company_report import report_share

    try:
        rid, cid = report_share.parse(t)
    except report_share.ShareError as e:
        raise HTTPException(403, str(e))
    r = await db.get(CompanyReport, rid)
    cl = await db.get(Client, cid)
    if r is None or cl is None or r.status != "final" or not r.content:
        raise HTTPException(404, "보고서를 찾을 수 없습니다. 담당자에게 문의해 주세요.")
    c = await db.get(PortfolioCompany, r.company_id)
    if c is None or c.deleted_at is not None:
        raise HTTPException(404, "보고서를 찾을 수 없습니다. 담당자에게 문의해 주세요.")
    return r, cl, c


@router.get("/m/report")
async def mobile_report(t: str = Query(..., max_length=200), db: AsyncSession = Depends(get_db)):
    """카톡·문자 [보고서 보기] → 고객용 폰 화면. 내부 표시(확인 필요·영업 노트·검토 의견)는 뺀다."""
    from app.models.company_report import ReportImage
    from app.services.company_report import exporters, report_share
    from app.services.company_report.half_year import half_label, period_text

    r, cl, c = await _public_report(db, t)
    imgs = (await db.execute(select(ReportImage).where(ReportImage.report_id == r.id, ReportImage.selected == True)  # noqa: E712
                             .order_by(ReportImage.sort_order))).scalars().all()
    return {"client_name": cl.name, "company_name": c.name, "period_label": half_label(r.period_year, r.period_half),
            "period_range": period_text(r.period_year, r.period_half),
            "as_of_date": r.as_of_date.isoformat() if r.as_of_date else None, "version": r.version,
            "contact": await exporters.contact_for(db, cl.user_id or r.owner_user_id),
            "content": report_share.public_content(r.content),
            "images": [{"id": i.id, "section_no": i.section_no, "caption": i.caption, "source_label": i.source_label}
                       for i in imgs]}


@router.get("/m/report/image/{image_id}")
async def mobile_report_image(image_id: str, t: str = Query(..., max_length=200), db: AsyncSession = Depends(get_db)):
    from fastapi.responses import Response

    from app.models.company_report import ReportImage
    from app.services.company_report import company_db, storage

    r, _, _ = await _public_report(db, t)
    im = await db.get(ReportImage, image_id)
    if im is None or im.report_id != r.id or not im.selected:
        raise HTTPException(404, "그림을 찾을 수 없습니다.")
    try:
        data = storage.read_bytes(im.storage_key)
    except Exception:
        raise HTTPException(404, "그림 파일이 없습니다.")
    ext = im.storage_key.rsplit(".", 1)[-1].lower()
    return Response(content=data, media_type=company_db.MIME.get(ext, "image/png"), headers={"Cache-Control": "private, max-age=3600"})


@router.get("/m/report/pdf")
async def mobile_report_pdf(t: str = Query(..., max_length=200), db: AsyncSession = Depends(get_db)):
    from app.services.company_report import exporters

    r, cl, _ = await _public_report(db, t)
    data, name, mime = await exporters.export(db, r, "pdf", user_id=None, client_id=cl.id, record=False)
    return _file_response(data, name, mime)
