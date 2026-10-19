"""'관련성 없는 기사' 제보 처리 (2026-10-19).

흐름: 제보(웹·폰) → 관리자 > 기사 제보 목록 → [Claude 분석](기사와 기업 정보·키워드를 비교해 왜 걸렸는지와
키워드 대안을 제안) → 기사 숨기기 / 키워드 수정(오른쪽 패널, 기존 PUT /companies/{id}) → 기존 기사 다시 점검.
"""
from __future__ import annotations

import logging
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.company_report import ArticleReport
from app.models.news_briefing import CompanyKeyword, NewsArticle, PortfolioCompany
from app.services.company_report.timeutil import now_kst

logger = logging.getLogger(__name__)

STATUSES = ("open", "resolved", "dismissed")
CAUSES = ("동명 회사", "동명이인", "다른 뜻의 단어", "업계 일반 기사", "키워드가 너무 넓음", "실제로 관련 있음", "기타")
ACTION_TYPES = ("add_exclude", "remove_required", "add_required", "remove_boost", "add_boost")


async def keyword_sets(db: AsyncSession, company_id: str) -> dict[str, list[str]]:
    rows = (await db.execute(select(CompanyKeyword).where(CompanyKeyword.company_id == company_id))).scalars().all()
    out: dict[str, list[str]] = {"required": [], "boost": [], "exclude": []}
    for r in rows:
        out.get(r.kind, out["boost"]).append(r.keyword)
    return out


async def create(db: AsyncSession, article: NewsArticle, *, user_id: Optional[str], name: Optional[str],
                 channel: str, reason: Optional[str]) -> tuple[ArticleReport, bool]:
    """(제보, 새로 만들었는지). 같은 사람이 같은 기사를 검토 대기 중에 또 누르면 앞 제보를 돌려준다."""
    q = select(ArticleReport).where(ArticleReport.article_id == article.id, ArticleReport.status == "open")
    q = q.where(ArticleReport.reporter_user_id == user_id) if user_id else q.where(ArticleReport.reporter_name == name)
    old = (await db.execute(q)).scalars().first()
    if old:
        return old, False
    rep = ArticleReport(article_id=article.id, company_id=article.company_id, reporter_user_id=user_id,
                        reporter_name=(name or "")[:100] or None, channel=channel, reason=(reason or "").strip()[:300] or None)
    db.add(rep)
    await db.flush()
    return rep, True


def _article_brief(a: NewsArticle) -> dict:
    return {"id": a.id, "title": a.title, "url": a.url, "press": a.press, "summary": a.summary,
            "description": a.description, "tag": a.tag, "is_hidden": a.is_hidden, "source_type": a.source_type,
            "collected_via": a.collected_via, "relevance_score": a.relevance_score,
            "published_at": a.published_at.isoformat() if a.published_at else None}


async def list_reports(db: AsyncSession, status: Optional[str] = "open", limit: int = 300) -> dict:
    from app.models.user import User

    stmt = select(ArticleReport, NewsArticle, PortfolioCompany).join(NewsArticle, NewsArticle.id == ArticleReport.article_id) \
        .join(PortfolioCompany, PortfolioCompany.id == ArticleReport.company_id)
    if status in STATUSES:
        stmt = stmt.where(ArticleReport.status == status)
    rows = (await db.execute(stmt.order_by(ArticleReport.created_at.desc()).limit(limit))).all()
    uids = {r.reporter_user_id for r, _, _ in rows if r.reporter_user_id} | {r.resolved_by for r, _, _ in rows if r.resolved_by}
    names = dict((await db.execute(select(User.id, User.nickname).where(User.id.in_(uids)))).all()) if uids else {}
    same = dict((await db.execute(select(ArticleReport.article_id, func.count()).where(
        ArticleReport.article_id.in_([a.id for _, a, _ in rows] or [""])).group_by(ArticleReport.article_id))).all())
    counts = dict((await db.execute(select(ArticleReport.status, func.count()).group_by(ArticleReport.status))).all())
    items = [{
        "id": r.id, "status": r.status, "channel": r.channel, "reason": r.reason,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "reporter_name": names.get(r.reporter_user_id or "") or r.reporter_name or "-",
        "company": {"id": c.id, "name": c.name, "is_active": c.is_active},
        "article": _article_brief(a), "same_article_reports": int(same.get(a.id, 1)),
        "ai_analysis": r.ai_analysis, "ai_analyzed_at": r.ai_analyzed_at.isoformat() if r.ai_analyzed_at else None,
        "resolution": r.resolution, "resolved_by_name": names.get(r.resolved_by or ""),
        "resolved_at": r.resolved_at.isoformat() if r.resolved_at else None,
    } for r, a, c in rows]
    return {"items": items, "counts": {k: int(counts.get(k, 0)) for k in STATUSES}}


ANALYZE_SYSTEM = "너는 투자기업 뉴스 수집 시스템의 품질 담당자다. 기사가 그 기업 이야기인지 판정하고, 수집 키워드를 어떻게 고치면 같은 오탐이 줄지 제안한다."
ANALYZE_PROMPT = """[기업 정보]
이름: {name} / 영문: {name_en} / 이전 사명·약칭: {aliases}
대표자: {ceo} / 업종: {industry} / 소재지: {address} / 홈페이지: {homepage} / 상장: {listed}

[수집 키워드] (필수어 = 기사에 꼭 들어가야 하는 말, 보조어 = 있으면 점수 가산, 제외어 = 있으면 버림)
필수어: {required}
보조어: {boost}
제외어: {exclude}

[이 기업으로 모인 최근 기사 제목(참고 — 일부는 오탐일 수 있음)]
{recent}

[제보된 기사]
제목: {title}
매체·날짜: {press} {date}
요약: {summary}
본문 앞부분·설명: {description}
제보 사유: {reason}

할 일
1) 이 기사가 위 기업에 관한 기사인지 판정한다(verdict: irrelevant / relevant / unclear).
2) 왜 이 기업으로 모였는지 원인을 하나 고른다(cause: {causes}).
3) 어떤 키워드 때문에 걸렸는지 추정한다(matched_by).
4) 같은 오탐을 줄일 키워드 수정안을 0~4개 낸다. 실제 기업 기사를 놓치지 않게 신중히:
   - add_exclude: 이 기사에만 있고 실제 기업 기사에는 없을 말(동명 회사 이름, 동명이인 소속, 다른 뜻의 문맥어 등)
   - remove_required / add_required: 필수어가 너무 넓거나 흔한 말이면 더 좁은 말로
   - add_boost / remove_boost
   기사가 실제로 관련 있으면 actions 는 비운다.
5) 관리자에게 한두 문장 결론(summary)과 기사 숨김 권고(hide_article)를 준다.

JSON 으로만 답하라:
{{"verdict": "irrelevant|relevant|unclear", "confidence": "high|mid|low", "cause": "...", "matched_by": "...",
  "reason": "판정 이유 2~3문장(기사 속 근거를 들어)",
  "actions": [{{"type": "add_exclude|remove_required|add_required|remove_boost|add_boost", "keyword": "...", "why": "..."}}],
  "hide_article": true, "summary": "..."}}"""


def _clean_analysis(d: dict, kw: dict[str, list[str]]) -> dict:
    verdict = d.get("verdict") if d.get("verdict") in ("irrelevant", "relevant", "unclear") else "unclear"
    actions = []
    for x in d.get("actions") or []:
        if not isinstance(x, dict) or x.get("type") not in ACTION_TYPES:
            continue
        k = str(x.get("keyword") or "").strip()[:100]
        if not k:
            continue
        t = x["type"]
        # 이미 반영된 것·없는 것을 지우라는 제안은 뺀다
        if (t == "add_exclude" and k in kw["exclude"]) or (t == "add_required" and k in kw["required"]) \
                or (t == "add_boost" and k in kw["boost"]) or (t == "remove_required" and k not in kw["required"]) \
                or (t == "remove_boost" and k not in kw["boost"]):
            continue
        actions.append({"type": t, "keyword": k, "why": str(x.get("why") or "")[:200]})
    return {
        "verdict": verdict, "confidence": d.get("confidence") if d.get("confidence") in ("high", "mid", "low") else "mid",
        "cause": str(d.get("cause") or "기타")[:30], "matched_by": str(d.get("matched_by") or "")[:100],
        "reason": str(d.get("reason") or "")[:800], "actions": actions[:4],
        "hide_article": bool(d.get("hide_article")) if verdict != "relevant" else False,
        "summary": str(d.get("summary") or "")[:300],
    }


async def analyze(db: AsyncSession, rep: ArticleReport) -> dict:
    from app.services import llm_client
    from app.services.company_report import config
    from app.services.company_report.keys import get_service_key, release

    a = await db.get(NewsArticle, rep.article_id)
    c = await db.get(PortfolioCompany, rep.company_id)
    kw = await keyword_sets(db, c.id)
    recent = (await db.execute(select(NewsArticle.title).where(
        NewsArticle.company_id == c.id, NewsArticle.is_hidden == False, NewsArticle.id != a.id)  # noqa: E712
        .order_by(NewsArticle.published_at.desc().nullslast()).limit(12))).scalars().all()
    key = await get_service_key(db, "claude")
    if not key:
        raise llm_client.LLMError("Claude 키가 없어 분석하지 못했습니다(설정 > API 키).")
    models = await config.get_models(db)
    prompt = ANALYZE_PROMPT.format(
        name=c.name, name_en=c.name_en or "-", aliases=", ".join(c.aliases or []) or "-", ceo=c.ceo_name or "-",
        industry=c.industry or "-", address=c.address or "-", homepage=c.homepage or "-",
        listed=f"상장({c.stock_code})" if c.is_listed else "비상장",
        required=", ".join(kw["required"]) or "(없음)", boost=", ".join(kw["boost"]) or "(없음)",
        exclude=", ".join(kw["exclude"]) or "(없음)", recent="\n".join(f"- {t}" for t in recent) or "(없음)",
        title=a.title, press=a.press or "-", date=a.published_at.date().isoformat() if a.published_at else "-",
        summary=a.summary or "-", description=(a.description or "-")[:1500], reason=rep.reason or "(없음)",
        causes=" / ".join(CAUSES))
    await release(db)
    r = await llm_client.claude_json(key[0], prompt, system=ANALYZE_SYSTEM, model=models["writer"], max_tokens=1500,
                                     stage="article_report")
    res = _clean_analysis(r.data if isinstance(r.data, dict) else {}, kw)
    rep.ai_analysis, rep.ai_analyzed_at = res, now_kst()
    await db.flush()
    return res


async def resolve(db: AsyncSession, rep: ArticleReport, *, action: str, user_id: str, note: Optional[str]) -> int:
    """action: hide(기사 숨기고 처리) / resolved(키워드 수정 등으로 처리, 기사는 그대로) / dismissed(관련 있음).
    같은 기사의 다른 검토 대기 제보도 함께 닫는다. 닫은 제보 수를 돌려준다."""
    a = await db.get(NewsArticle, rep.article_id)
    if action == "hide" and a and not a.is_hidden:
        a.is_hidden, a.hidden_at, a.hidden_by = True, now_kst(), user_id
        from app.services.company_report import search

        await search.index_article(db, a)
    status = "dismissed" if action == "dismissed" else "resolved"
    text = {"hide": "기사 숨김", "resolved": "키워드 수정 등으로 처리", "dismissed": "관련 있음 — 그대로 둠"}[action]
    resolution = (text + (f" · {note.strip()}" if note and note.strip() else ""))[:300]
    reps = (await db.execute(select(ArticleReport).where(
        ArticleReport.article_id == rep.article_id, ArticleReport.status == "open"))).scalars().all()
    if rep not in reps:
        reps.append(rep)
    for x in reps:
        x.status, x.resolution, x.resolved_by, x.resolved_at = status, resolution, user_id, now_kst()
    await db.flush()
    return len(reps)


async def recheck_company(db: AsyncSession, company_id: str, *, user_id: str, apply: bool, limit: int = 5000) -> dict:
    """지금 키워드의 제외어에 걸리는 기존 기사(숨기지 않은 것)를 찾는다. apply=True 면 숨긴다."""
    from app.services.company_report import search
    from app.services.company_report.dedup import relevance

    kw = await keyword_sets(db, company_id)
    if not kw["exclude"]:
        return {"matched": 0, "hidden": 0, "samples": [], "note": "제외어가 없어 점검할 것이 없습니다."}
    arts = (await db.execute(select(NewsArticle).where(
        NewsArticle.company_id == company_id, NewsArticle.is_hidden == False)  # noqa: E712
        .order_by(NewsArticle.published_at.desc().nullslast()).limit(limit))).scalars().all()
    hits = []
    for a in arts:
        rel = relevance(a.title or "", a.description or "", kw["required"], kw["boost"], kw["exclude"])
        if rel.excluded:
            hits.append((a, rel.reason))
    hidden = 0
    if apply:
        for a, _ in hits:
            a.is_hidden, a.hidden_at, a.hidden_by = True, now_kst(), user_id
            await search.index_article(db, a)
            hidden += 1
        await db.flush()
    return {"matched": len(hits), "hidden": hidden,
            "samples": [{"title": a.title, "reason": why, "published_at": a.published_at.isoformat() if a.published_at else None}
                        for a, why in hits[:10]]}
