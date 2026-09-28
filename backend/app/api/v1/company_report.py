"""기업 리포트 API — /api/v1/company-report (기획 10장)."""
from __future__ import annotations

import logging

from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
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
from app.services.company_report import company_finder
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
                        date_from: Optional[date] = None, date_to: Optional[date] = None,
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
