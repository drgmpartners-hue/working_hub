"""기업 리포트 API — /api/v1/company-report (기획 10장)."""
from __future__ import annotations

import logging

from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy import and_, func, select
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
from app.services.company_report import company_finder, search
from app.services.company_report.timeutil import now_kst, today_kst

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/company-report", tags=["company-report"])


def require_admin(user) -> None:
    if not getattr(user, "is_superuser", False):
        raise HTTPException(403, "관리자 계정만 할 수 있습니다.")


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


def _out(c: PortfolioCompany, ks: KeywordSet, stats: Optional[dict] = None) -> CompanyOut:
    data = {k: getattr(c, k) for k in CompanyOut.model_fields if hasattr(c, k) and k not in ("keywords", "stats")}
    return CompanyOut(**data, keywords=ks, stats=stats or {})


@router.get("/companies", response_model=list[CompanyOut])
async def list_companies(active: Optional[bool] = None, q: Optional[str] = None,
                         current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    stmt = select(PortfolioCompany)
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
    return [_out(c, kws.get(c.id, KeywordSet()), stats.get(c.id, {"today": 0, "week": 0, "caution_week": 0, "total": 0}))
            for c in companies]


@router.post("/companies", response_model=CompanyOut, status_code=201)
async def create_company(body: CompanyCreate, background: BackgroundTasks,
                         current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    dup = (await db.execute(select(PortfolioCompany).where(
        (PortfolioCompany.corp_code == body.corp_code) if body.corp_code else (PortfolioCompany.name == body.name)
    ))).scalars().first()
    if dup:
        raise HTTPException(409, f"이미 등록된 기업입니다: {dup.name}")
    data = body.model_dump(exclude={"keywords", "backfill_months"})
    company = PortfolioCompany(**data)
    db.add(company)
    await db.flush()
    ks = body.keywords
    if not ks.required:
        ks.required = [body.name]
    await _replace_keywords(db, company.id, ks)
    await search.index_company(db, company, ks.required + ks.boost)
    await db.commit()
    await db.refresh(company)
    if body.backfill_months > 0:
        background.add_task(_run_initial_backfill, company.id, body.backfill_months, current_user.id)
    return _out(company, await _keywords(db, company.id))


async def _run_initial_backfill(company_id: str, months: int, user_id: str) -> None:
    """등록 직후 기본 백필(네이버·DART). 별도 세션에서 실행."""
    from app.services.company_report import collector

    async with AsyncSessionLocal() as db:
        await collector.basic_backfill(db, company_id, months=months, user_id=user_id)


@router.get("/companies/{company_id}", response_model=CompanyOut)
async def get_company(company_id: str, current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    c = await db.get(PortfolioCompany, company_id)
    if not c:
        raise HTTPException(404, "기업을 찾을 수 없습니다.")
    return _out(c, await _keywords(db, c.id))


@router.put("/companies/{company_id}", response_model=CompanyOut)
async def update_company(company_id: str, body: CompanyUpdate, current_user=Depends(get_current_user),
                         db: AsyncSession = Depends(get_db)):
    c = await db.get(PortfolioCompany, company_id)
    if not c:
        raise HTTPException(404, "기업을 찾을 수 없습니다.")
    data = body.model_dump(exclude_unset=True, exclude={"keywords"})
    if "name" in data and data["name"] and data["name"] != c.name:
        # 이전 사명은 별칭으로 보존(검색·기업DB용)
        aliases = list(c.aliases or [])
        if c.name not in aliases:
            aliases.append(c.name)
        c.aliases = aliases
    for k, v in data.items():
        setattr(c, k, v)
    if body.keywords is not None:
        await _replace_keywords(db, c.id, body.keywords)
    await db.flush()
    ks = await _keywords(db, c.id)
    await search.index_company(db, c, ks.required + ks.boost)
    await db.commit()
    await db.refresh(c)
    return _out(c, await _keywords(db, c.id))


@router.delete("/companies/{company_id}", status_code=204)
async def deactivate_company(company_id: str, current_user=Depends(get_current_user),
                             db: AsyncSession = Depends(get_db)):
    """삭제하지 않고 비활성화한다(수집만 멈추고 데이터는 보존)."""
    c = await db.get(PortfolioCompany, company_id)
    if not c:
        raise HTTPException(404, "기업을 찾을 수 없습니다.")
    c.is_active = False
    await search.index_company(db, c)
    await db.commit()


@router.post("/companies/{company_id}/collect")
async def collect_now(company_id: str, background: BackgroundTasks, current_user=Depends(get_current_user),
                      db: AsyncSession = Depends(get_db)):
    c = await db.get(PortfolioCompany, company_id)
    if not c:
        raise HTTPException(404, "기업을 찾을 수 없습니다.")
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


@router.get("/companies/{company_id}/backfill-jobs")
async def list_backfill_jobs(company_id: str, current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(BackfillJob).where(BackfillJob.company_id == company_id).order_by(BackfillJob.created_at.desc()).limit(10)
    )).scalars().all()
    return [{
        "id": j.id, "period_from": j.period_from.isoformat(), "period_to": j.period_to.isoformat(),
        "trigger": j.trigger, "status": j.status, "progress": j.progress, "source_stats": j.source_stats,
        "coverage": j.coverage, "verdict": j.verdict, "error": j.error,
        "created_at": j.created_at.isoformat() if j.created_at else None,
        "finished_at": j.finished_at.isoformat() if j.finished_at else None,
    } for j in rows]


@router.get("/me")
async def me(current_user=Depends(get_current_user)):
    """화면에서 관리자 전용 버튼(승인 등) 표시 여부."""
    return {"id": current_user.id, "is_admin": bool(getattr(current_user, "is_superuser", False))}


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
async def get_daily_briefing(date_: Optional[date] = Query(None, alias="date"), current_user=Depends(get_current_user),
                             db: AsyncSession = Depends(get_db)):
    """해당 날짜 브리핑. 날짜가 없으면 가장 최근 것."""
    stmt = select(NewsBriefing)
    stmt = stmt.where(NewsBriefing.briefing_date == date_) if date_ else stmt.order_by(NewsBriefing.briefing_date.desc()).limit(1)
    b = (await db.execute(stmt)).scalars().first()
    if not b:
        raise HTTPException(404, "브리핑이 없습니다.")
    return _briefing_out(b)


@router.get("/briefings/daily/list")
async def list_daily_briefings(limit: int = Query(30, ge=1, le=120), current_user=Depends(get_current_user),
                               db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(NewsBriefing.id, NewsBriefing.briefing_date, NewsBriefing.status, NewsBriefing.article_count,
               NewsBriefing.caution_count, NewsBriefing.is_fallback)
        .order_by(NewsBriefing.briefing_date.desc()).limit(limit)
    )).all()
    return [{"id": r[0], "briefing_date": r[1].isoformat(), "status": r[2], "article_count": r[3],
             "caution_count": r[4], "is_fallback": r[5]} for r in rows]


class BuildRequest(BaseModel):
    briefing_date: Optional[date] = None
    collect: bool = True


@router.post("/briefings/daily/build")
async def build_daily_now(body: BuildRequest, background: BackgroundTasks, current_user=Depends(get_current_user)):
    """관리자: 브리핑을 지금 다시 만든다(휴일이어도, 마감 시간 제한 없이)."""
    require_admin(current_user)
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
    require_admin(current_user)
    b = await db.get(NewsBriefing, briefing_id)
    if not b:
        raise HTTPException(404, "브리핑이 없습니다.")
    if b.status == "sent":
        raise HTTPException(409, "이미 발송된 브리핑입니다.")
    b.status, b.approved_by, b.approved_at = "approved", current_user.id, now_kst()
    await db.commit()
    return _briefing_out(b)


# --------------------------------------------------------------------------- 발송: 수신자·설정·테스트

class RecipientsBody(BaseModel):
    user_ids: list[str]


@router.get("/recipients")
async def get_recipients(current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """직원 명단 + 선택 여부. 휴대폰 번호가 없으면 선택할 수 없다."""
    from app.models.user import User

    selected = set((await db.execute(
        select(BriefingRecipient.user_id).where(BriefingRecipient.is_active == True)  # noqa: E712
    )).scalars().all())
    users = (await db.execute(select(User).where(User.is_active == True).order_by(User.nickname))).scalars().all()  # noqa: E712
    return [{
        "user_id": u.id, "nickname": u.nickname, "email": u.email,
        "phone_masked": (u.phone[:3] + "-****-" + u.phone[-4:]) if u.phone and len(u.phone) >= 8 else None,
        "has_phone": bool(u.phone), "selected": u.id in selected,
    } for u in users]


@router.put("/recipients")
async def put_recipients(body: RecipientsBody, current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    require_admin(current_user)
    from app.models.user import User

    ids = list(dict.fromkeys(body.user_ids))
    if len(ids) > 5:
        raise HTTPException(422, "수신자는 최대 5명입니다.")
    users = (await db.execute(select(User).where(User.id.in_(ids or [""])))).scalars().all()
    no_phone = [u.nickname for u in users if not u.phone]
    if no_phone:
        raise HTTPException(422, f"휴대폰 번호가 없는 직원: {', '.join(no_phone)}")
    existing = {r.user_id: r for r in (await db.execute(select(BriefingRecipient))).scalars().all()}
    for uid, r in existing.items():
        r.is_active = uid in ids
    for uid in ids:
        if uid not in existing:
            db.add(BriefingRecipient(user_id=uid, is_active=True))
    await db.commit()
    return {"count": len(ids)}


class SettingsBody(BaseModel):
    enabled: Optional[bool] = None
    review_until: Optional[date] = None
    restart_approval: bool = False
    template_daily: Optional[str] = None
    template_monthly: Optional[str] = None
    weather_region: Optional[str] = None
    main_model: Optional[str] = None
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


async def _settings_out(db: AsyncSession) -> dict:
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
    logs = (await db.execute(select(BriefingSendLog).order_by(BriefingSendLog.sent_at.desc()).limit(20))).scalars().all()
    return {
        "enabled": await settings_store.get_bool(db, crcfg.BRIEFING_ENABLED, default=False),
        "review_until": until.isoformat() if until else None,
        "approval_required_today": await crcfg.approval_required(db, today),
        "approval_days_left": max(0, (until - today).days + 1) if until else None,
        "template_daily": await settings_store.get(db, crcfg.TEMPLATE_DAILY) or "",
        "template_monthly": await settings_store.get(db, crcfg.TEMPLATE_MONTHLY) or "",
        "weather_region": await settings_store.get(db, crcfg.WEATHER_REGION, crcfg.DEFAULT_REGION),
        "models": await crcfg.get_models(db),
        "last_run_at": await settings_store.get(db, crcfg.LAST_RUN_AT),
        "last_send_at": await settings_store.get(db, crcfg.LAST_SEND_AT),
        "keys": keys,
        "send_logs": [{
            "briefing_type": l.briefing_type, "briefing_id": l.briefing_id, "phone": l.phone[:3] + "****" + l.phone[-4:],
            "channel": l.channel, "status": l.status, "error": l.error,
            "sent_at": l.sent_at.isoformat() if l.sent_at else None,
        } for l in logs],
    }


@router.get("/settings")
async def get_settings(current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await _settings_out(db)


@router.put("/settings")
async def put_settings(body: SettingsBody, current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    require_admin(current_user)
    from app.services import settings_store
    from app.services.company_report import config as crcfg

    today = today_kst()
    if body.enabled is not None:
        await settings_store.set_value(db, crcfg.BRIEFING_ENABLED, "1" if body.enabled else "0")
        # 처음 켤 때 승인 기간(평일 7일) 시작
        if body.enabled and not await crcfg.review_until(db):
            await settings_store.set_value(db, crcfg.REVIEW_UNTIL, _add_business_days(today, crcfg.APPROVAL_DAYS).isoformat())
    if body.restart_approval:
        await settings_store.set_value(db, crcfg.REVIEW_UNTIL, _add_business_days(today, crcfg.APPROVAL_DAYS).isoformat())
    elif body.review_until is not None:
        await settings_store.set_value(db, crcfg.REVIEW_UNTIL, body.review_until.isoformat())
    for field, key in (("template_daily", crcfg.TEMPLATE_DAILY), ("template_monthly", crcfg.TEMPLATE_MONTHLY),
                       ("weather_region", crcfg.WEATHER_REGION), ("main_model", crcfg.MAIN_MODEL),
                       ("review_model", crcfg.REVIEW_MODEL), ("summary_model", crcfg.SUMMARY_MODEL)):
        v = getattr(body, field)
        if v is not None:
            await settings_store.set_value(db, key, v.strip())
    return await _settings_out(db)


@router.post("/briefings/daily/{briefing_id}/test-send")
async def test_send(briefing_id: str, current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """본인 휴대폰으로 테스트 발송(상태 변화 없음)."""
    from app.services.company_report import sender

    r = await sender.send_test(db, briefing_id, current_user)
    if not r.get("success"):
        raise HTTPException(400, f"테스트 발송 실패: {r.get('error')}")
    return r


@router.post("/briefings/daily/send-now")
async def send_now(current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """관리자: 오늘 브리핑을 지금 발송(배치와 같은 조건·중복 차단)."""
    require_admin(current_user)
    from app.services.company_report import sender

    return await sender.send_daily(db)


# --------------------------------------------------------------------------- P2: 기사 아카이브(달력·기간 요약)

@router.get("/companies/{company_id}/article-dates")
async def get_article_dates(company_id: str, month: str = Query(..., pattern=r"^\d{4}-\d{2}$"),
                            current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from app.services.company_report import period

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
async def extract_facts_now(company_id: str, background: BackgroundTasks, current_user=Depends(get_current_user)):
    """아직 사실 추출이 안 된 기사에서 후보를 다시 뽑는다(백그라운드)."""
    background.add_task(_run_extract, company_id)
    return {"queued": True}


async def _run_extract(company_id: str) -> None:
    from app.services.company_report import facts as facts_svc

    async with AsyncSessionLocal() as db:
        await facts_svc.extract_pending(db, company_id=company_id, limit=400)


# --------------------------------------------------------------------------- P2: 통합 검색

@router.get("/search")
async def do_search(q: str = Query(..., min_length=1, max_length=200), group: Optional[str] = None,
                    company: Optional[list[str]] = Query(None), date_from: Optional[date] = None,
                    date_to: Optional[date] = None, tag: Optional[str] = None, include_inactive: bool = True,
                    sort: str = Query("relevance", pattern="^(relevance|recent)$"),
                    page: int = Query(1, ge=1), size: int = Query(20, ge=1, le=100),
                    current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await search.search(db, q, group=group, company_ids=company, date_from=date_from, date_to=date_to, tag=tag,
                               include_inactive=include_inactive, sort=sort, page=page, size=size)


@router.get("/search/suggest")
async def search_suggest(q: str = "", current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await search.suggest(db, q)


@router.post("/search/reindex")
async def search_reindex(current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    require_admin(current_user)
    return await search.reindex_all(db)


# --------------------------------------------------------------------------- P2: 기업DB(파일)

@router.get("/db/tree")
async def db_tree(current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from app.services.company_report import company_db

    return await company_db.tree(db)


@router.get("/db/files")
async def db_files(company: Optional[list[str]] = Query(None), portfolio: bool = False, folder: Optional[str] = None,
                   type: Optional[str] = None, origin: Optional[str] = None, status: Optional[str] = None,
                   date_from: Optional[date] = None, date_to: Optional[date] = None, q: Optional[str] = None,
                   include_inactive: bool = True, page: int = Query(1, ge=1), size: int = Query(50, ge=1, le=200),
                   current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from app.services.company_report import company_db

    return await company_db.list_files(db, company_ids=company, portfolio=portfolio, folder=folder, file_type=type,
                                       origin=origin, status=status, date_from=date_from, date_to=date_to, q=q,
                                       include_inactive=include_inactive, page=page, size=size)


@router.post("/db/files", status_code=201)
async def db_upload(file: UploadFile = File(...), company_id: Optional[str] = Form(None), folder: str = Form("docs"),
                    doc_kind: Optional[str] = Form(None), memo: Optional[str] = Form(None),
                    current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """업로드 — 파일명 규칙에 맞게 자동으로 이름이 바뀐다(원래 이름은 따로 보관)."""
    from app.services.company_report import company_db

    data = await file.read()
    try:
        f = await company_db.upload_file(db, company_id=company_id or None, folder=folder, filename=file.filename or "file",
                                         data=data, user_id=current_user.id, doc_kind=(doc_kind or None), memo=memo)
    except ValueError as e:
        raise HTTPException(422, str(e))
    await db.commit()
    await db.refresh(f)
    return company_db.file_out(f)


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
    if body.deleted:
        # 삭제는 올린 사람 또는 관리자만, 자동 파일은 삭제하지 않는다(파일은 남기고 목록에서만 뺀다)
        if f.origin == "auto":
            raise HTTPException(400, "자동으로 만들어지는 파일은 지울 수 없습니다.")
        if f.created_by != current_user.id and not getattr(current_user, "is_superuser", False):
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
    data, name = await company_db.zip_company(db, cid)
    await company_db.log_download(db, file_id=None, company_id=cid, user_id=current_user.id, kind="zip")
    return Response(content=data, media_type="application/zip",
                    headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(name)}"})


@router.post("/db/companies/{company_id}/refresh")
async def db_refresh(company_id: str, current_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """자동 파일(월별 뉴스 모음·사실 원장·투자유치 엑셀·기업카드) 지금 다시 만들기."""
    from app.services.company_report import company_db

    return await company_db.refresh_auto_files(db, company_id)


async def _refresh_files_bg(company_id: str) -> None:
    from app.services.company_report import company_db

    async with AsyncSessionLocal() as db:
        try:
            await company_db.refresh_auto_files(db, company_id)
        except Exception:
            logger.exception("자동 파일 갱신 실패")
