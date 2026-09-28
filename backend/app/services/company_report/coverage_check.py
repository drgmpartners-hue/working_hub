"""과거 데이터 구축 검증 ①~⑥과 판정(기획 7-5, P2-12).

① 기간 커버리지  ② 출처 간 대조·수집률 추정  ③ 핵심 사건 점검(Claude·Gemini 웹 검색)
④ DART 대조  ⑤ 관련도 샘플 검수(담당자 20건)  ⑥ 사실 추출 점검 → 판정: 충분 / 보완 필요 / 부족
"""
from __future__ import annotations

import logging
import random
from collections import Counter
from datetime import date, datetime, timedelta
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.company_report import CompanyFact
from app.models.news_briefing import NewsArticle, PortfolioCompany
from app.services import llm_client
from app.services.company_report import config
from app.services.company_report.dedup import title_similarity
from app.services.company_report.keys import get_service_key, release

logger = logging.getLogger(__name__)

RECALL_PASS = 0.9
SAMPLE_SIZE = 20
SAMPLE_PASS = 0.9
FEW_ARTICLES = 5
EVENT_MATCH = 0.3
EVENT_DAYS = 10


# --------------------------------------------------------------------------- 순수 계산

def months_between(start: date, end: date) -> list[str]:
    out, y, m = [], start.year, start.month
    while (y, m) <= (end.year, end.month):
        out.append(f"{y:04d}-{m:02d}")
        y, m = (y + (m == 12), m % 12 + 1)
    return out


def coverage_counts(pub_dates: list[datetime], start: date, end: date) -> dict:
    monthly = {m: 0 for m in months_between(start, end)}
    weekly: Counter = Counter()
    for d in pub_dates:
        k = d.strftime("%Y-%m")
        if k in monthly:
            monthly[k] += 1
        iso = d.isocalendar()
        weekly[f"{iso[0]}-W{iso[1]:02d}"] += 1
    return {"monthly": monthly, "weekly": dict(sorted(weekly.items())), "zero_months": [m for m, n in monthly.items() if n == 0]}


def _match(a: dict, b: dict, threshold: float = 0.55) -> bool:
    pa, pb = a.get("published_at"), b.get("published_at")
    if pa and pb and abs((pa - pb).total_seconds()) > 2 * 86400:
        return False
    return title_similarity(a["title"], b["title"]) >= threshold


def estimate_recall(naver: list[dict], google: list[dict]) -> dict:
    """두 출처 겹침으로 전체 기사 수 추정(Chapman 추정량) → 수집률. 겹침 0이면 추정 불가(순수 로직)."""
    n1, n2 = len(naver), len(google)
    matched_google = set()
    m = 0
    for i, g in enumerate(google):
        for nv in naver:
            if _match(g, nv):
                m += 1
                matched_google.add(i)
                break
    unique = n1 + n2 - m
    if n1 == 0 or n2 == 0 or m == 0:
        return {"naver": n1, "google": n2, "overlap": m, "unique": unique, "estimated_total": None, "recall": None}
    est = (n1 + 1) * (n2 + 1) / (m + 1) - 1
    return {"naver": n1, "google": n2, "overlap": m, "unique": unique, "estimated_total": round(est, 1),
            "recall": round(min(1.0, unique / est), 3) if est > 0 else None}


def match_events(events: list[dict], articles: list[dict]) -> list[dict]:
    """핵심 사건마다 수집 기사에 있는지(날짜 ±10일, 제목·요약 유사도 0.3 이상)."""
    out = []
    for ev in events:
        ed = _parse_date(ev.get("date"))
        best, best_sim = None, 0.0
        for a in articles:
            ad = a["published_at"].date() if a.get("published_at") else None
            if ed and ad and abs((ad - ed).days) > EVENT_DAYS:
                continue
            text = a["title"] + " " + (a.get("summary") or "")
            sim = max(title_similarity(ev.get("title", ""), a["title"]), title_similarity(ev.get("title", ""), text))
            if sim > best_sim:
                best, best_sim = a, sim
        found = best is not None and best_sim >= EVENT_MATCH
        out.append({**ev, "found": found, "article_id": best["id"] if found else None,
                    "article_title": best["title"] if found else None, "similarity": round(best_sim, 2)})
    return out


def merge_event_lists(a: list[dict], b: list[dict]) -> list[dict]:
    out = [dict(x, by=["claude"]) for x in a]
    for ev in b:
        dup = next((x for x in out if title_similarity(x.get("title", ""), ev.get("title", "")) >= 0.45), None)
        if dup:
            dup["by"] = sorted(set(dup["by"]) | {"gemini"})
        else:
            out.append(dict(ev, by=["gemini"]))
    return out


def _parse_date(v) -> Optional[date]:
    try:
        return date.fromisoformat(str(v)[:10])
    except (TypeError, ValueError):
        return None


def decide(checks: dict, total_articles: int) -> tuple[str, list[str]]:
    """판정과 이유(순수 로직). checks[n] = {"pass": True/False/None(대기·해당 없음)}."""
    if total_articles < FEW_ARTICLES:
        return "insufficient", [f"기간 중 기사 {total_articles}건 — 자료 요청 중심으로 보고서를 쓰세요"]
    reasons = []
    labels = {"c1": "① 기간 커버리지", "c2": "② 수집률", "c3": "③ 핵심 사건", "c4": "④ DART 대조", "c5": "⑤ 샘플 검수", "c6": "⑥ 사실 추출"}
    for k, label in labels.items():
        st = (checks.get(k) or {}).get("pass")
        if st is False:
            reasons.append(f"{label} 미통과: {(checks.get(k) or {}).get('note', '')}".strip())
        elif st is None and k == "c5":
            reasons.append("⑤ 샘플 검수 대기(담당자 20건 확인 필요)")
    return ("sufficient" if not reasons else "needs_more"), reasons


# --------------------------------------------------------------------------- 검사

KEY_EVENTS_PROMPT = """웹에서 '{name}'(대표 {ceo}, 업종 {industry})에 관해 {date_from} ~ {date_to} 사이에 실제로 일어난 핵심 사건을 찾아라.
대상: 투자유치, 계약·수주, 제품 출시, 인증·허가, 수상·정부과제 선정, 대표·임원 인사, 소송·제재.
동명 회사와 혼동하지 말고, 날짜와 출처가 확인되는 것만. 최대 12개.
출력 JSON: {{"events": [{{"date": "YYYY-MM-DD", "type": "funding", "title": "사건 한 줄(회사명 포함)", "source_url": "근거 주소"}}]}}"""


async def key_events(db: AsyncSession, company: PortfolioCompany, start: date, end: date) -> dict:
    prompt = KEY_EVENTS_PROMPT.format(name=company.name, ceo=company.ceo_name or "-", industry=company.industry or "-",
                                      date_from=start.isoformat(), date_to=end.isoformat())
    models = await config.get_models(db)
    res: dict[str, list] = {"claude": [], "gemini": []}
    errors = {}
    claude = await get_service_key(db, "claude")
    if claude:
        try:
            await release(db)
            r = await llm_client.claude_json(claude[0], prompt, model=models["main"], web_search=True, max_tokens=3000)
            res["claude"] = [e for e in ((r.data or {}).get("events") or []) if isinstance(e, dict) and e.get("title")]
        except llm_client.LLMError as e:
            errors["claude"] = str(e)
    gemini = await get_service_key(db, "gemini")
    if gemini:
        try:
            await release(db)
            r = await llm_client.gemini_json(gemini[0], prompt, model=models["review"], grounding=True)
            res["gemini"] = [e for e in ((r.data or {}).get("events") or []) if isinstance(e, dict) and e.get("title")]
        except llm_client.LLMError as e:
            errors["gemini"] = str(e)
    events = [e for e in merge_event_lists(res["claude"], res["gemini"])
              if not _parse_date(e.get("date")) or start <= _parse_date(e.get("date")) <= end]
    return {"events": events, "errors": errors, "sources": {k: len(v) for k, v in res.items()}}


async def period_articles(db: AsyncSession, company_id: str, start: date, end: date) -> list[dict]:
    rows = (await db.execute(select(NewsArticle).where(
        NewsArticle.company_id == company_id, NewsArticle.is_hidden == False,  # noqa: E712
        NewsArticle.published_at >= datetime.combine(start, datetime.min.time()),
        NewsArticle.published_at < datetime.combine(end + timedelta(days=1), datetime.min.time()),
    ))).scalars().all()
    return [{"id": a.id, "title": a.title, "summary": a.summary, "published_at": a.published_at, "source": a.source,
             "source_type": a.source_type, "is_representative": a.is_representative} for a in rows]


def pick_sample(articles: list[dict], n: int = SAMPLE_SIZE, seed: Optional[int] = None) -> list[dict]:
    reps = [a for a in articles if a["is_representative"] and a["source_type"] != "dart"]
    rnd = random.Random(seed)
    chosen = rnd.sample(reps, min(n, len(reps)))
    return [{"article_id": a["id"], "title": a["title"], "date": a["published_at"].date().isoformat() if a["published_at"] else None}
            for a in chosen]


async def facts_check(db: AsyncSession, company_id: str, matched_events: list[dict]) -> dict:
    facts = (await db.execute(select(CompanyFact).where(CompanyFact.company_id == company_id,
                                                        CompanyFact.status.in_(["candidate", "confirmed"])))).scalars().all()
    rows = []
    for ev in matched_events:
        if not ev.get("found"):
            continue
        ed = _parse_date(ev.get("date"))
        hit = next((f for f in facts if (not ed or not f.fact_date or abs((f.fact_date - ed).days) <= 30)
                    and (title_similarity(f.title, ev.get("title", "")) >= 0.25 or f.fact_type == ev.get("type"))), None)
        rows.append({"event": ev.get("title"), "fact_id": hit.id if hit else None, "fact_title": hit.title if hit else None})
    missing = [r for r in rows if not r["fact_id"]]
    return {"pass": not missing if rows else None, "rows": rows,
            "note": f"핵심 사건 {len(rows)}건 중 원장 후보 없음 {len(missing)}건" if rows else "대조할 핵심 사건 없음"}
