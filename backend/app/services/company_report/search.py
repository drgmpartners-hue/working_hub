"""통합 검색(기획 7-4) — 색인 갱신·검색·자동완성·재색인.

- 모든 저장·수정 함수가 index_entity / remove_entity를 호출한다(저장 즉시 반영)
- 검색: 단어별 AND, "따옴표"는 구절 일치, 띄어쓰기 무시(norm 컬럼), 기업 별칭은 기업명으로도 찾음
- pg_trgm GIN 인덱스가 있으면 ILIKE가 인덱스를 탄다(없어도 동작)
"""
from __future__ import annotations

import re
from datetime import date
from typing import Any, Iterable, Optional

from sqlalchemy import and_, case, delete, func, literal, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.company_report import CompanyFact, CompanyFile, CompanyFundingRound, SearchIndex
from app.models.news_briefing import CompanyKeyword, NewsArticle, NewsBriefing, PortfolioCompany

ENTITY_TYPES = ["company", "article", "fact", "funding", "daily", "monthly", "digest", "report_section", "file"]
TYPE_GROUP = {  # 결과 탭(기획: 전체·기업·기사·원장·브리핑·보고서·자료)
    "company": "company", "article": "article", "fact": "ledger", "funding": "ledger",
    "daily": "briefing", "monthly": "briefing", "digest": "briefing",
    "report_section": "report", "file": "file",
}
GROUP_TYPES: dict[str, list[str]] = {}
for _t, _g in TYPE_GROUP.items():
    GROUP_TYPES.setdefault(_g, []).append(_t)

BASE = "/content/company-report"


def normalize(text: Optional[str]) -> str:
    return re.sub(r"\s+", "", (text or "")).lower()


def parse_query(q: str) -> list[str]:
    """'바이오 "시리즈 B"' → ['바이오', '시리즈 B']. 1글자 영문·숫자 단독은 버리지 않는다(한글 1글자도 허용)."""
    q = (q or "").strip()
    phrases = re.findall(r'"([^"]+)"', q)
    rest = re.sub(r'"[^"]*"', " ", q)
    words = [w for w in re.split(r"\s+", rest) if w]
    out, seen = [], set()
    for t in phrases + words:
        t = t.strip()
        if t and t.lower() not in seen:
            seen.add(t.lower())
            out.append(t)
    return out[:8]


def snippet(body: Optional[str], terms: list[str], width: int = 70) -> str:
    """본문에서 첫 검색어 주변을 잘라 반환(강조는 화면에서)."""
    body = re.sub(r"\s+", " ", body or "").strip()
    if not body:
        return ""
    low = body.lower()
    pos = min([p for p in (low.find(t.lower()) for t in terms) if p >= 0] or [0])
    start = max(0, pos - width)
    end = min(len(body), pos + width * 2)
    return ("…" if start > 0 else "") + body[start:end] + ("…" if end < len(body) else "")


# --------------------------------------------------------------------------- 색인 갱신

async def index_entity(db: AsyncSession, entity_type: str, entity_id: str, *, title: str, body: str = "",
                       company_id: Optional[str] = None, doc_date: Optional[date] = None,
                       tags: Optional[list] = None, url_path: Optional[str] = None, is_latest: bool = True) -> None:
    title = (title or "").strip()[:2000] or "(제목 없음)"
    body = (body or "")[:20000]
    values = dict(entity_type=entity_type, entity_id=str(entity_id), company_id=company_id, title=title, body=body,
                  norm=normalize(title + " " + body)[:20000], doc_date=doc_date, tags=tags or [],
                  url_path=url_path, is_latest=is_latest)
    stmt = pg_insert(SearchIndex).values(id=_new_id(), **values)
    stmt = stmt.on_conflict_do_update(
        constraint="uq_search_entity",
        set_={k: stmt.excluded[k] for k in values if k not in ("entity_type", "entity_id")} | {"updated_at": func.now()},
    )
    await db.execute(stmt)


async def remove_entity(db: AsyncSession, entity_type: str, entity_id: str) -> None:
    await db.execute(delete(SearchIndex).where(SearchIndex.entity_type == entity_type, SearchIndex.entity_id == str(entity_id)))


def _new_id() -> str:
    import uuid

    return str(uuid.uuid4())


async def index_company(db: AsyncSession, c: PortfolioCompany, keywords: Optional[Iterable[str]] = None) -> None:
    if keywords is None:
        keywords = (await db.execute(select(CompanyKeyword.keyword).where(CompanyKeyword.company_id == c.id))).scalars().all()
    body = " ".join(x for x in [c.name_en, " ".join(c.aliases or []), c.ceo_name, c.industry, c.address,
                                " ".join(keywords or []), c.memo] if x)
    await index_entity(db, "company", c.id, company_id=c.id, title=c.name, body=body,
                       tags=["active" if c.is_active else "inactive"], url_path=f"{BASE}/companies/{c.id}")


async def index_article(db: AsyncSession, a: NewsArticle) -> None:
    if a.is_hidden or not a.is_representative:
        await remove_entity(db, "article", a.id)
        return
    d = a.published_at.date() if a.published_at else None
    body = " ".join(x for x in [a.summary, a.description, a.press] if x)
    await index_entity(db, "article", a.id, company_id=a.company_id, title=a.title, body=body, doc_date=d,
                       tags=[t for t in [a.tag, a.issue_type, a.source_type] if t],
                       url_path=f"{BASE}/companies/{a.company_id}?tab=archive" + (f"&date={d.isoformat()}" if d else ""))


async def index_fact(db: AsyncSession, f: CompanyFact) -> None:
    if f.status in ("rejected", "superseded"):
        await remove_entity(db, "fact", f.id)
        return
    detail = f.detail or {}
    body = " ".join(str(v) for v in detail.values() if v and not isinstance(v, (dict, list)))
    await index_entity(db, "fact", f.id, company_id=f.company_id, title=f.title, body=body, doc_date=f.fact_date,
                       tags=[f.fact_type, f.status], url_path=f"{BASE}/companies/{f.company_id}?tab=ledger")


async def index_funding(db: AsyncSession, r: CompanyFundingRound) -> None:
    if r.status == "rejected":
        await remove_entity(db, "funding", r.id)
        return
    inv = ", ".join(i.get("name", "") for i in (r.investors or []) if isinstance(i, dict))
    amt = f"{r.amount / 1e8:,.0f}억 원" if r.amount else "비공개"
    await index_entity(db, "funding", r.id, company_id=r.company_id, title=f"{r.round_name or '투자유치'} {amt}",
                       body=f"투자사 {inv}".strip(), doc_date=r.round_date, tags=["funding", r.status],
                       url_path=f"{BASE}/companies/{r.company_id}?tab=ledger")


async def index_daily(db: AsyncSession, b: NewsBriefing) -> None:
    parts = [b.overall_summary or ""]
    for c in b.company_summaries or []:
        parts.append(f"{c.get('name', '')}: {c.get('one_liner') or ''}")
    await index_entity(db, "daily", b.id, title=f"{b.briefing_date.isoformat()} 데일리 브리핑", body="\n".join(parts),
                       doc_date=b.briefing_date, tags=[b.status],
                       url_path=f"{BASE}/briefing?date={b.briefing_date.isoformat()}")


async def index_file(db: AsyncSession, f: CompanyFile, company_name: Optional[str] = None) -> None:
    if f.status == "deleted":
        await remove_entity(db, "file", f.id)
        return
    body = " ".join(x for x in [company_name, f.original_name, f.doc_kind, f.memo, f.search_text] if x)
    doc_date = f.created_at.date() if f.created_at else None
    await index_entity(db, "file", f.id, company_id=f.company_id, title=f.display_name, body=body, doc_date=doc_date,
                       tags=[f.folder, f.file_type, f.origin], url_path=f"{BASE}/db?file={f.id}")


# --------------------------------------------------------------------------- 검색

async def _alias_map(db: AsyncSession) -> dict[str, str]:
    """별칭(이전 사명·약칭·영문명) → 현재 기업명."""
    rows = (await db.execute(select(PortfolioCompany.name, PortfolioCompany.name_en, PortfolioCompany.aliases))).all()
    m: dict[str, str] = {}
    for name, en, aliases in rows:
        for a in [en, *(aliases or [])]:
            if a and a.strip() and a.strip() != name:
                m[a.strip().lower()] = name
    return m


def _term_cond(term: str, alias_to: Optional[str]):
    variants = [term] + ([alias_to] if alias_to else [])
    conds = []
    for v in variants:
        like = f"%{v}%"
        conds += [SearchIndex.title.ilike(like), SearchIndex.body.ilike(like)]
        n = normalize(v)
        if n and n != v.lower():
            conds.append(SearchIndex.norm.like(f"%{n}%"))
    return or_(*conds)


async def search(db: AsyncSession, q: str, *, group: Optional[str] = None, company_ids: Optional[list[str]] = None,
                 date_from: Optional[date] = None, date_to: Optional[date] = None, tag: Optional[str] = None,
                 include_inactive: bool = True, sort: str = "relevance", page: int = 1, size: int = 20) -> dict[str, Any]:
    terms = parse_query(q)
    if not terms:
        return {"q": q, "terms": [], "total": 0, "counts": {}, "items": []}
    aliases = await _alias_map(db)
    base = [_term_cond(t, aliases.get(t.lower())) for t in terms]
    base.append(SearchIndex.is_latest == True)  # noqa: E712
    if company_ids:
        base.append(SearchIndex.company_id.in_(company_ids))
    if date_from:
        base.append(SearchIndex.doc_date >= date_from)
    if date_to:
        base.append(SearchIndex.doc_date <= date_to)
    if tag:
        base.append(SearchIndex.tags.contains([tag]))
    if not include_inactive:
        inactive = select(PortfolioCompany.id).where(PortfolioCompany.is_active == False)  # noqa: E712
        base.append(or_(SearchIndex.company_id.is_(None), SearchIndex.company_id.not_in(inactive)))

    # 종류별 건수(탭)
    rows = (await db.execute(select(SearchIndex.entity_type, func.count()).where(and_(*base)).group_by(SearchIndex.entity_type))).all()
    counts: dict[str, int] = {}
    for t, n in rows:
        g = TYPE_GROUP.get(t, t)
        counts[g] = counts.get(g, 0) + n
    counts["all"] = sum(v for k, v in counts.items() if k != "all")

    cond = list(base)
    if group and group != "all":
        cond.append(SearchIndex.entity_type.in_(GROUP_TYPES.get(group, [group])))

    # 관련도 점수: 제목 일치 > 본문 일치, 전체 구절이 제목에 있으면 가점, 기업 항목 가점
    full = " ".join(terms)
    score = literal(0)
    for t in terms:
        score = score + case((SearchIndex.title.ilike(f"%{t}%"), 3), else_=0) + case((SearchIndex.body.ilike(f"%{t}%"), 1), else_=0)
    score = score + case((SearchIndex.title.ilike(f"%{full}%"), 3), else_=0) + case((SearchIndex.entity_type == "company", 2), else_=0)
    order = [SearchIndex.doc_date.desc().nullslast(), score.desc()] if sort == "recent" else [score.desc(), SearchIndex.doc_date.desc().nullslast()]

    total = (await db.execute(select(func.count()).select_from(SearchIndex).where(and_(*cond)))).scalar_one()
    res = (await db.execute(
        select(SearchIndex, score.label("score"), PortfolioCompany.name)
        .outerjoin(PortfolioCompany, PortfolioCompany.id == SearchIndex.company_id)
        .where(and_(*cond)).order_by(*order).offset((page - 1) * size).limit(size)
    )).all()
    items = [{
        "type": s.entity_type, "group": TYPE_GROUP.get(s.entity_type, s.entity_type), "id": s.entity_id,
        "company_id": s.company_id, "company_name": cname, "title": s.title, "snippet": snippet(s.body, terms),
        "date": s.doc_date.isoformat() if s.doc_date else None, "tags": s.tags or [], "url": s.url_path, "score": int(sc or 0),
    } for s, sc, cname in res]
    return {"q": q, "terms": terms, "total": total, "counts": counts, "items": items, "page": page, "size": size}


async def suggest(db: AsyncSession, q: str, limit: int = 8) -> list[dict]:
    q = (q or "").strip()
    if not q:
        return []
    like = f"%{q}%"
    rows = (await db.execute(
        select(PortfolioCompany.id, PortfolioCompany.name, PortfolioCompany.is_active)
        .where(or_(PortfolioCompany.name.ilike(like), PortfolioCompany.name_en.ilike(like),
                   func.cast(PortfolioCompany.aliases, type_=_text_type()).ilike(like)))
        .order_by(PortfolioCompany.is_active.desc(), func.length(PortfolioCompany.name)).limit(limit)
    )).all()
    return [{"id": r[0], "name": r[1], "is_active": r[2]} for r in rows]


def _text_type():
    from sqlalchemy import Text

    return Text()


# --------------------------------------------------------------------------- 재색인·점검

async def reindex_all(db: AsyncSession) -> dict[str, int]:
    """관리자 [색인 다시 만들기] / 매일 점검 배치. 모든 원천에서 다시 색인한다."""
    stats: dict[str, int] = {}
    await db.execute(delete(SearchIndex))
    kws: dict[str, list[str]] = {}
    for cid, kw in (await db.execute(select(CompanyKeyword.company_id, CompanyKeyword.keyword))).all():
        kws.setdefault(cid, []).append(kw)
    companies = (await db.execute(select(PortfolioCompany))).scalars().all()
    for c in companies:
        await index_company(db, c, kws.get(c.id, []))
    stats["company"] = len(companies)
    n = 0
    for a in (await db.execute(select(NewsArticle).where(NewsArticle.is_hidden == False, NewsArticle.is_representative == True))).scalars():  # noqa: E712
        await index_article(db, a)
        n += 1
    stats["article"] = n
    facts = (await db.execute(select(CompanyFact).where(CompanyFact.status.in_(["candidate", "confirmed"])))).scalars().all()
    for f in facts:
        await index_fact(db, f)
    stats["fact"] = len(facts)
    rounds = (await db.execute(select(CompanyFundingRound).where(CompanyFundingRound.status != "rejected"))).scalars().all()
    for r in rounds:
        await index_funding(db, r)
    stats["funding"] = len(rounds)
    briefings = (await db.execute(select(NewsBriefing))).scalars().all()
    for b in briefings:
        await index_daily(db, b)
    stats["daily"] = len(briefings)
    names = {c.id: c.name for c in companies}
    files = (await db.execute(select(CompanyFile).where(CompanyFile.status != "deleted"))).scalars().all()
    for f in files:
        await index_file(db, f, names.get(f.company_id))
    stats["file"] = len(files)
    await db.commit()
    return stats


async def check_missing(db: AsyncSession) -> dict[str, int]:
    """누락 점검: 원천 수와 색인 수가 다르면 전체 재색인."""
    idx = dict((await db.execute(select(SearchIndex.entity_type, func.count()).group_by(SearchIndex.entity_type))).all())
    src = {
        "company": (await db.execute(select(func.count()).select_from(PortfolioCompany))).scalar_one(),
        "article": (await db.execute(select(func.count()).select_from(NewsArticle).where(
            NewsArticle.is_hidden == False, NewsArticle.is_representative == True))).scalar_one(),  # noqa: E712
        "daily": (await db.execute(select(func.count()).select_from(NewsBriefing))).scalar_one(),
    }
    diff = {k: src[k] - idx.get(k, 0) for k in src if src[k] != idx.get(k, 0)}
    if diff:
        await reindex_all(db)
    return {"diff": diff, "reindexed": bool(diff)}
