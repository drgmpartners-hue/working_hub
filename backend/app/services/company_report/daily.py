"""데일리 브리핑 작성(기획 5장·11장 데일리 1~5).

순서: 수집 → 요약 → 기본정보(날씨·전일 증시·건수) → Opus 초안(문장별 출처) → Gemini 1차 → Claude 2차
→ NewsBriefing 저장(승인 기간이면 draft, 이후 approved).
08:20(KST)까지 교차 검토가 끝나지 않거나 실패하면 기사 요약만 담은 단순 브리핑(is_fallback)으로 저장한다.
"""
from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from datetime import date, datetime, time, timedelta
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.news_briefing import NewsArticle, NewsBriefing, PortfolioCompany
from app.services import llm_client, settings_store
from app.services.collectors import data_go_kr
from app.services.collectors.market_indices import previous_day_indices
from app.services.company_report import collector, config, cross_review, summarizer
from app.services.company_report.keys import get_service_key
from app.services.company_report.timeutil import now_kst, today_kst

logger = logging.getLogger(__name__)

DEADLINE = time(8, 20)
TOP_PER_COMPANY = 3
MAX_SOURCES = 80
TAG_ORDER = {"caution": 0, "positive": 1, "neutral": 2, None: 3}

DRAFT_PROMPT = """너는 벤처캐피탈 영업 직원에게 아침 브리핑을 쓰는 애널리스트다. 오늘은 {day}이다.
아래 [출처]는 투자기업별 최신 기사·공시 요약이다. 이것만 근거로 써라. 출처에 없는 사실·숫자·전망을 만들지 마라.

작성할 것
1) overall: 오늘 꼭 봐야 할 내용 3~5문장. 주의(caution) 이슈를 먼저. 문장마다 근거 출처 id를 단다.
2) companies: 기사가 있는 기업마다 한 줄 요약 1문장(60자 내외). 근거 출처 id를 단다.
문체: 짧은 평서문(~했다/~이다), 두괄식, 고등학생도 이해할 쉬운 말. 과장·투자 권유 금지.

[출처]
{sources}

출력 JSON
{{"overall": [{{"text": "...", "source_ids": ["A1"]}}],
  "companies": [{{"company_id": "...", "text": "...", "source_ids": ["A3"]}}]}}"""


# --------------------------------------------------------------------------- 기간·기본정보

async def previous_business_day(service_key: Optional[str], day: date) -> date:
    d = day - timedelta(days=1)
    for _ in range(15):
        if await data_go_kr.is_business_day(service_key, d):
            return d
        d -= timedelta(days=1)
    return day - timedelta(days=1)


async def article_window(service_key: Optional[str], day: date) -> tuple[datetime, datetime]:
    """직전 영업일 07:00 ~ 오늘 07:00 (월요일이면 금요일 07:00부터 주말 포함)."""
    prev = await previous_business_day(service_key, day)
    return datetime.combine(prev, time(7, 0)), datetime.combine(day, time(7, 0))


async def build_basic_info(db: AsyncSession, day: date) -> dict:
    dg = await get_service_key(db, "data_go_kr")
    kis = await get_service_key(db, "kis")
    region = await settings_store.get(db, config.WEATHER_REGION, config.DEFAULT_REGION) or config.DEFAULT_REGION
    weather, indices = await asyncio.gather(
        data_go_kr.get_weather(dg[0] if dg else None, day, region),
        previous_day_indices(day, kis),
    )
    wd = "월화수목금토일"[day.weekday()]
    return {"date": day.isoformat(), "weekday": wd, "weather": weather, "markets": indices}


# --------------------------------------------------------------------------- 기사 묶기

def group_articles(articles: list[NewsArticle], companies: dict[str, PortfolioCompany]) -> list[dict]:
    """기업별 카드(주의 먼저, 관련도 높은 순). 순수 로직."""
    by: dict[str, list[NewsArticle]] = defaultdict(list)
    for a in articles:
        by[a.company_id].append(a)
    cards = []
    for cid, arts in by.items():
        c = companies.get(cid)
        if not c:
            continue
        arts.sort(key=lambda a: (TAG_ORDER.get(a.tag, 3), -(a.relevance_score or 0), -(a.published_at or datetime.min).timestamp()))
        cards.append({
            "company_id": cid,
            "name": c.name,
            "article_count": len(arts),
            "caution_count": sum(1 for a in arts if a.tag == "caution"),
            "one_liner": None,
            "articles": [{
                "id": a.id, "title": a.title, "url": a.url, "press": a.press, "source_type": a.source_type,
                "published_at": a.published_at.isoformat() if a.published_at else None,
                "summary": a.summary, "tag": a.tag, "issue_type": a.issue_type,
            } for a in arts],
        })
    cards.sort(key=lambda x: (-x["caution_count"], -x["article_count"], x["name"]))
    return cards


def build_sources(cards: list[dict]) -> tuple[list[dict], dict[str, str]]:
    """초안·검토용 출처 목록 [A1..]과 출처id→기사id 매핑."""
    sources, mapping = [], {}
    n = 0
    for card in cards:
        for a in card["articles"][: max(TOP_PER_COMPANY + 2, 5)]:
            n += 1
            sid = f"A{n}"
            mapping[sid] = a["id"]
            text = f"[{card['name']}] ({a['tag'] or '-'}, {a['issue_type'] or '-'}, {(a['published_at'] or '')[:10]}) {a['title']} — {a['summary'] or ''}"
            sources.append({"id": sid, "company_id": card["company_id"], "text": text})
            if n >= MAX_SOURCES:
                return sources, mapping
    return sources, mapping


def fallback_content(cards: list[dict]) -> tuple[list[dict], dict[str, str]]:
    """단순 브리핑: AI 문장 없이 집계 + 기업별 대표 기사 요약."""
    total = sum(c["article_count"] for c in cards)
    caution = sum(c["caution_count"] for c in cards)
    if not cards:
        overall = [{"text": "지난 영업일 이후 투자기업 관련 새 기사가 없습니다.", "source_ids": []}]
    else:
        overall = [{"text": f"{len(cards)}개 기업에서 기사 {total}건이 새로 나왔고, 주의 이슈는 {caution}건입니다.", "source_ids": []}]
        for c in cards:
            if c["caution_count"]:
                a = next(x for x in c["articles"] if x["tag"] == "caution")
                overall.append({"text": f"[주의] {c['name']}: {a['summary'] or a['title']}", "source_ids": []})
    one = {c["company_id"]: (c["articles"][0]["summary"] or c["articles"][0]["title"]) for c in cards if c["articles"]}
    return overall, one


def apply_ai(cards: list[dict], draft: dict, outcome: cross_review.ReviewOutcome) -> list[dict]:
    """검토를 통과한 문장만 반영. overall 반환, cards의 one_liner 채움."""
    kept = {s["id"]: s for s in outcome.sentences}
    overall = [{"text": s["text"], "source_ids": s.get("source_ids", [])}
               for s in outcome.sentences if s.get("section") == "overall"]
    for s in kept.values():
        if s.get("section") == "company":
            for c in cards:
                if c["company_id"] == s.get("company_id"):
                    c["one_liner"] = s["text"]
    return overall


def draft_sentences(draft: dict) -> list[dict]:
    out = []
    for i, s in enumerate(draft.get("overall") or [], 1):
        if isinstance(s, dict) and s.get("text"):
            out.append({"id": f"o{i}", "section": "overall", "text": s["text"], "source_ids": s.get("source_ids") or []})
    for i, s in enumerate(draft.get("companies") or [], 1):
        if isinstance(s, dict) and s.get("text"):
            out.append({"id": f"c{i}", "section": "company", "company_id": s.get("company_id"),
                        "text": s["text"], "source_ids": s.get("source_ids") or []})
    return out


# --------------------------------------------------------------------------- 작성

async def _ai_briefing(db: AsyncSession, day: date, briefing_id: str, cards: list[dict]) -> tuple[list[dict], dict]:
    claude = await get_service_key(db, "claude")
    if not claude:
        raise llm_client.LLMError("Claude 키가 없습니다")
    gemini = await get_service_key(db, "gemini")
    models = await config.get_models(db)
    sources, _ = build_sources(cards)
    src_txt = "\n".join(f"[{s['id']}] (company_id={s['company_id']}) {s['text']}" for s in sources)
    prompt = DRAFT_PROMPT.format(day=f"{day.isoformat()}({'월화수목금토일'[day.weekday()]})", sources=src_txt)
    r = await llm_client.claude_json(claude[0], prompt, model=models["main"], max_tokens=4000)
    await cross_review.log_draft(db, "daily", briefing_id, r, models["main"], prompt)
    draft = r.data if isinstance(r.data, dict) else {}
    sentences = draft_sentences(draft)
    outcome = await cross_review.review_sentences(
        db, sources=sources, sentences=sentences, claude_key=claude[0], gemini_key=gemini[0] if gemini else None,
        models=models, target_type="daily", target_id=briefing_id, mode="briefing",
    )
    if not outcome.review2_ok:
        raise llm_client.LLMError("2차 검토 실패")
    overall = apply_ai(cards, draft, outcome)
    if not overall:
        raise llm_client.LLMError("검토 후 남은 종합 문장이 없습니다")
    return overall, {**outcome.summary, "removed": outcome.removed[:20], "missing": outcome.missing[:10]}


def _seconds_until_deadline(now: datetime, day: date) -> float:
    return (datetime.combine(day, DEADLINE) - now).total_seconds()


async def build_daily(db: AsyncSession, day: Optional[date] = None, *, collect: bool = True,
                      force: bool = False, use_deadline: bool = True) -> dict:
    """데일리 브리핑을 만든다. 이미 발송된 날은 건드리지 않는다."""
    day = day or today_kst()
    dg = await get_service_key(db, "data_go_kr")
    dg_key = dg[0] if dg else None
    holiday = await data_go_kr.holiday_name(dg_key, day)
    if holiday and not force:
        return {"skipped": f"{day} {holiday}"}

    existing = (await db.execute(select(NewsBriefing).where(NewsBriefing.briefing_date == day))).scalar_one_or_none()
    if existing and existing.status == "sent":
        return {"skipped": "이미 발송됨", "briefing_id": existing.id}

    if collect:
        stats = await collector.collect_all(db, via="daily")
        logger.info("데일리 수집: %s", stats)
        await summarizer.summarize_pending(db, limit=400)

    start, end = await article_window(dg_key, day)
    companies = {c.id: c for c in (await db.execute(
        select(PortfolioCompany).where(PortfolioCompany.is_active == True)  # noqa: E712
    )).scalars().all()}
    arts = (await db.execute(
        select(NewsArticle).where(
            NewsArticle.company_id.in_(list(companies) or [""]),
            NewsArticle.is_hidden == False,  # noqa: E712
            NewsArticle.is_representative == True,  # noqa: E712
            NewsArticle.published_at >= start,
            NewsArticle.published_at < end,
        )
    )).scalars().all()
    cards = group_articles(list(arts), companies)
    basic = await build_basic_info(db, day)
    basic.update({
        "window": [start.isoformat(), end.isoformat()],
        "company_total": len(companies),
        "company_with_news": len(cards),
        "article_count": sum(c["article_count"] for c in cards),
        "caution_count": sum(c["caution_count"] for c in cards),
    })

    b = existing or NewsBriefing(briefing_date=day)
    if not existing:
        db.add(b)
    await db.flush()

    is_fallback, review = False, {}
    if cards:
        try:
            timeout = _seconds_until_deadline(now_kst(), day) if use_deadline else 900
            if timeout < 60:
                raise asyncio.TimeoutError()
            overall, review = await asyncio.wait_for(_ai_briefing(db, day, b.id, cards), timeout=timeout)
        except (asyncio.TimeoutError, llm_client.LLMError, Exception) as e:  # noqa: BLE001 — 어떤 실패든 단순 브리핑으로
            logger.warning("데일리 AI 브리핑 실패 → 단순 브리핑: %r", e)
            is_fallback, review = True, {"fallback_reason": str(e) or type(e).__name__}
            overall, one = fallback_content(cards)
            for c in cards:
                c["one_liner"] = one.get(c["company_id"])
    else:
        overall, _ = fallback_content(cards)
    for c in cards:
        if not c["one_liner"] and c["articles"]:
            c["one_liner"] = c["articles"][0]["summary"] or c["articles"][0]["title"]
        c["articles"] = c["articles"][:TOP_PER_COMPANY] + [
            {**a, "more": True} for a in c["articles"][TOP_PER_COMPANY:]
        ]

    need_approval = await config.approval_required(db, day)
    b.basic_info = basic
    b.overall_summary = "\n".join(s["text"] for s in overall)
    b.company_summaries = cards
    b.article_ids = [a["id"] for c in cards for a in c["articles"]]
    b.article_count = basic["article_count"]
    b.caution_count = basic["caution_count"]
    b.is_fallback = is_fallback
    b.review_summary = {**review, "overall": overall}
    b.status = "draft" if need_approval else "approved"
    if b.status == "draft":
        b.approved_by = b.approved_at = None
    await settings_store.set_value(db, config.LAST_RUN_AT, now_kst().isoformat(timespec="seconds"))
    await db.commit()
    return {"briefing_id": b.id, "status": b.status, "fallback": is_fallback,
            "articles": b.article_count, "companies": len(cards)}
