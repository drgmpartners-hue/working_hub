"""로그인 없는 폰 전용 브리핑 화면(/m/daily, /m/monthly)에 보낼 데이터.

문장마다 근거 기사 번호 refs=[1,2]를 달고, refs 목록에 번호별 원문 주소를 담는다(화면에서 [1]을 누르면 바로 원문).
내부 검토 기록·수신자 정보 등은 보내지 않는다(읽기 전용 요약과 기사 링크만).
"""
from __future__ import annotations

from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.company_report import CompanyFact
from app.models.news_briefing import NewsBriefing

MAX_REFS = 3


class _Refs:
    def __init__(self, info: dict[str, dict]):
        self.info = info          # 키 → {url, title, press, date}
        self.order: list[str] = []

    def nums(self, keys: list[str]) -> list[int]:
        out: list[int] = []
        for k in keys or []:
            if k not in self.info or not self.info[k].get("url"):
                continue
            if k not in self.order:
                self.order.append(k)
            n = self.order.index(k) + 1
            if n not in out:
                out.append(n)
            if len(out) >= MAX_REFS:
                break
        return out

    def listing(self) -> list[dict]:
        return [{"n": i, **{k: self.info[key].get(k) for k in ("url", "title", "press", "date")}}
                for i, key in enumerate(self.order, 1)]


def daily_view(b: NewsBriefing) -> dict[str, Any]:
    from app.services.company_report.sender import _daily_parts

    lines, cards = _daily_parts(b)
    info = b.basic_info or {}
    arts = {a["id"]: {"url": a.get("url"), "title": a.get("title"), "press": a.get("press"),
                      "date": (a.get("published_at") or "")[:10]}
            for c in cards for a in c.get("articles") or []}
    refs = _Refs(arts)
    overall = [{"text": ln["text"], "refs": refs.nums(ln["article_ids"])} for ln in lines]
    companies = []
    for c in cards:
        al = c.get("articles") or []
        top = next((a for a in al if not a.get("more")), None)
        companies.append({
            "name": c.get("name"), "article_count": c.get("article_count", len(al)), "caution_count": c.get("caution_count", 0),
            "one_liner": c.get("one_liner") or "", "refs": refs.nums([top["id"]]) if top else [],
            "articles": [{"title": a.get("title"), "url": a.get("url"), "press": a.get("press"), "tag": a.get("tag"),
                          "summary": a.get("summary"), "published_at": a.get("published_at"),
                          "dart": a.get("source_type") == "dart"} for a in al],
        })
    w = info.get("weather") or {}
    return {
        "kind": "daily", "date": b.briefing_date.isoformat(), "weekday": info.get("weekday"),
        "weather": (f"{w.get('region') or '서울'} {w.get('text') or ''}".strip() if w.get("available") else None),
        "markets": [{k: m.get(k) for k in ("name", "market", "close", "change_pct", "available", "unit", "trade_date")}
                    for m in info.get("markets") or []],
        "company_count": info.get("company_with_news", len(cards)), "article_count": b.article_count or 0,
        "caution_count": b.caution_count or 0, "is_fallback": bool(b.is_fallback),
        "overall": overall, "companies": companies, "refs": refs.listing(),
    }


async def monthly_view(db: AsyncSession, mb) -> dict[str, Any]:
    c = mb.content or {}
    src = c.get("sources") or {}
    fact_ids = [v["id"] for v in src.values() if v.get("type") == "fact" and v.get("id")]
    fact_urls: dict[str, str] = {}
    if fact_ids:
        for f in (await db.execute(select(CompanyFact).where(CompanyFact.id.in_(fact_ids)))).scalars():
            u = next((r.get("url") for r in f.source_refs or [] if isinstance(r, dict) and r.get("url")), None)
            if u:
                fact_urls[f.id] = u
    info = {sid: {"url": v.get("url") if v.get("type") == "article" else fact_urls.get(v.get("id", "")),
                  "title": v.get("title"), "press": v.get("press"), "date": v.get("date")} for sid, v in src.items()}
    refs = _Refs(info)

    def sent(x: Optional[dict]) -> Optional[dict]:
        if not isinstance(x, dict) or not x.get("text"):
            return None
        return {"text": x["text"], "refs": refs.nums(x.get("source_ids") or [])}

    out_companies = []
    for sec in c.get("companies") or []:
        out_companies.append({
            "name": sec.get("name"), "article_count": sec.get("article_count", 0), "caution_count": sec.get("caution_count", 0),
            "summary": [s for s in (sent(x) for x in sec.get("summary") or []) if s],
            "facts": [{**s, "date": x.get("date", "")} for x in sec.get("facts") or [] if (s := sent(x))],
            "meaning": sent(sec.get("meaning")),
            "qa": [{"q": x.get("q"), "a": x.get("a"), "refs": refs.nums(x.get("source_ids") or [])} for x in sec.get("qa") or []],
            "client_explain": sent(sec.get("client_explain")),  # 화면에서 카드 맨 아래 → 번호도 마지막
        })
    st = mb.stats or {}
    return {
        "kind": "monthly", "month": mb.month,
        "article_count": st.get("article_count", 0), "caution_count": st.get("caution_count", 0),
        "prev_article_count": st.get("prev_article_count", 0), "company_with_news": st.get("company_with_news", 0),
        "summary": [s for s in (sent(x) for x in c.get("summary") or []) if s],
        "highlights": [{"name": x.get("name"), **s} for x in c.get("highlights") or [] if (s := sent(x))],
        "cautions": [{"name": x.get("name"), "what": sent(x.get("what")), "impact": sent(x.get("impact")), "check": sent(x.get("check"))}
                     for x in c.get("cautions") or []],
        "checkpoints": [{"name": x.get("name"), "when": x.get("when"), **s} for x in c.get("checkpoints") or [] if (s := sent(x))],
        "companies": out_companies, "refs": refs.listing(),
    }
