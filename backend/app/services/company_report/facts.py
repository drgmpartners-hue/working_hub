"""기업 사실 원장·투자유치 후보 자동 추출(P2-3).

요약된 대표 기사(주로 투자유치·실적·제품·수상·인사·제휴·규제·소송·공시)에서
사실 후보(candidate)를 뽑아 company_facts에, 투자 라운드는 company_funding_rounds에 올린다.
담당자가 [확정]/[제외]한다. 같은 사건이 여러 기사에 나오면 출처만 합친다.
"""
from __future__ import annotations

import hashlib
import logging
import re
from collections import defaultdict
from datetime import date
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.company_report import CompanyFact, CompanyFundingRound
from app.models.news_briefing import NewsArticle, PortfolioCompany
from app.services import llm_client
from app.services.company_report import config, search
from app.services.company_report.dedup import title_similarity
from app.services.company_report.keys import get_service_key, release
from app.services.company_report.timeutil import now_kst

logger = logging.getLogger(__name__)

FACT_TYPES = {
    "funding": "투자유치", "contract": "계약·수주", "certification": "인증·허가", "product": "제품·출시",
    "people": "인사", "financial": "실적·재무", "legal": "소송·규제", "award": "수상·선정", "other": "기타",
}
# 사실이 나올 만한 기사 유형(요약 단계 issue_type)
FACT_ISSUES = {"투자유치", "실적", "제품", "수상", "인사", "제휴", "규제", "소송", "공시"}
BATCH = 15
SIMILAR = 0.5
WINDOW_DAYS = 45

EXTRACT_PROMPT = """너는 벤처캐피탈의 투자기업 기록 담당이다. 대상 기업: {name}
아래 기사 요약에서 '{name}'에 대해 확인된 사실만 뽑아라. 추측·전망·다른 회사 이야기는 버려라.

사실 유형(fact_type): funding(투자유치), contract(계약·수주·제휴), certification(인증·허가·특허), product(제품·서비스 출시),
people(대표·임원 인사), financial(매출·영업이익 등 실적), legal(소송·규제·제재), award(수상·정부과제 선정), other
- fact_date: 사건 날짜(YYYY-MM-DD). 기사에 없으면 기사 날짜
- title: 40자 이내 한 줄(예: "시리즈B 150억 원 투자유치")
- detail: 핵심 수치·상대방 등 짧은 key-value
- funding 유형이면 funding 객체를 채운다: round_name(시드/프리A/시리즈A/시리즈B/…/브릿지/정책자금/기타),
  amount_krw(원 단위 정수, 모르면 null), investors([{{"name":"", "lead": true/false}}]), valuation_krw(모르면 null), is_follow_on(기존 투자사 후속 참여면 true)
- article_ids: 근거 기사 id 목록

기사:
{articles}

출력 JSON: {{"facts": [{{"fact_type": "funding", "fact_date": "2026-09-01", "title": "...", "detail": {{}},
"funding": null, "article_ids": ["..."]}}]}}
사실이 없으면 {{"facts": []}}"""


def dedup_key(company_id: str, fact_type: str, title: str) -> str:
    t = re.sub(r"[^0-9a-z가-힣]", "", (title or "").lower())
    return hashlib.sha1(f"{company_id}|{fact_type}|{t}".encode()).hexdigest()[:40]


def parse_date(v, fallback: Optional[date]) -> Optional[date]:
    if isinstance(v, str):
        try:
            return date.fromisoformat(v[:10])
        except ValueError:
            pass
    return fallback


def to_int(v) -> Optional[int]:
    try:
        n = int(float(v))
        return n if n > 0 else None
    except (TypeError, ValueError):
        return None


def find_duplicate(existing: list[CompanyFact], fact_type: str, title: str, fact_date: Optional[date]) -> Optional[CompanyFact]:
    """같은 유형, 날짜 ±45일, 제목 유사도 0.5 이상이면 같은 사실로 본다(순수 로직)."""
    best, best_sim = None, 0.0
    for f in existing:
        if f.fact_type != fact_type or f.status in ("rejected", "superseded"):
            continue
        if fact_date and f.fact_date and abs((f.fact_date - fact_date).days) > WINDOW_DAYS:
            continue
        sim = title_similarity(f.title, title)
        if sim >= SIMILAR and sim > best_sim:
            best, best_sim = f, sim
    return best


def _refs(arts: list[NewsArticle]) -> list[dict]:
    return [{"article_id": a.id, "url": a.url, "title": a.title,
             "date": a.published_at.date().isoformat() if a.published_at else None} for a in arts]


def merge_refs(old: Optional[list], new: list[dict]) -> list[dict]:
    seen = {r.get("article_id") or r.get("url") for r in (old or [])}
    out = list(old or [])
    for r in new:
        k = r.get("article_id") or r.get("url")
        if k not in seen:
            seen.add(k)
            out.append(r)
    return out


async def _apply(db: AsyncSession, company_id: str, items: list[dict], arts_by_id: dict[str, NewsArticle],
                 existing: list[CompanyFact]) -> dict:
    added = merged = rounds = 0
    for it in items or []:
        ftype = str(it.get("fact_type") or "other").strip()
        if ftype not in FACT_TYPES:
            ftype = "other"
        title = str(it.get("title") or "").strip()[:300]
        if not title:
            continue
        srcs = [arts_by_id[x] for x in (it.get("article_ids") or []) if x in arts_by_id]
        if not srcs:
            continue  # 근거 없는 사실은 올리지 않는다
        first = min((a.published_at for a in srcs if a.published_at), default=None)
        fdate = parse_date(it.get("fact_date"), first.date() if first else None)
        detail = it.get("detail") if isinstance(it.get("detail"), dict) else {}
        dup = find_duplicate(existing, ftype, title, fdate)
        if dup:
            dup.source_refs = merge_refs(dup.source_refs, _refs(srcs))
            merged += 1
            fact = dup
        else:
            fact = CompanyFact(company_id=company_id, fact_type=ftype, fact_date=fdate, title=title, detail=detail,
                               source_refs=_refs(srcs), status="candidate", origin="ai",
                               dedup_key=dedup_key(company_id, ftype, title))
            db.add(fact)
            await db.flush()
            existing.append(fact)
            added += 1
        await search.index_fact(db, fact)

        fd = it.get("funding") if isinstance(it.get("funding"), dict) else None
        if ftype == "funding" and fd:
            rounds += await _upsert_round(db, company_id, fact, fd, fdate, srcs)
    return {"added": added, "merged": merged, "rounds": rounds}


async def _upsert_round(db: AsyncSession, company_id: str, fact: CompanyFact, fd: dict, fdate: Optional[date],
                        srcs: list[NewsArticle]) -> int:
    name = str(fd.get("round_name") or "기타").strip()[:50]
    amount = to_int(fd.get("amount_krw"))
    investors = [{"name": str(i.get("name")).strip(), "lead": bool(i.get("lead"))}
                 for i in (fd.get("investors") or []) if isinstance(i, dict) and i.get("name")]
    rows = (await db.execute(select(CompanyFundingRound).where(
        CompanyFundingRound.company_id == company_id, CompanyFundingRound.status != "rejected"))).scalars().all()
    for r in rows:
        same_round = (r.round_name or "") == name
        near = not (fdate and r.round_date) or abs((r.round_date - fdate).days) <= 60
        if r.fact_id == fact.id or (same_round and near):
            r.source_refs = merge_refs(r.source_refs, _refs(srcs))
            if r.status == "candidate":  # 확정 전이면 빈 값 보충
                r.amount = r.amount or amount
                r.amount_disclosed = bool(r.amount)
                names = {i["name"] for i in (r.investors or [])}
                r.investors = (r.investors or []) + [i for i in investors if i["name"] not in names]
            await search.index_funding(db, r)
            return 0
    r = CompanyFundingRound(company_id=company_id, round_date=fdate, round_name=name, amount=amount,
                            amount_disclosed=bool(amount), investors=investors, valuation=to_int(fd.get("valuation_krw")),
                            is_follow_on=bool(fd.get("is_follow_on")), source_refs=_refs(srcs), status="candidate",
                            origin="ai", fact_id=fact.id)
    db.add(r)
    await db.flush()
    await search.index_funding(db, r)
    return 1


async def extract_pending(db: AsyncSession, company_id: Optional[str] = None, limit: int = 300) -> dict:
    """요약은 끝났고 사실 추출은 안 된 대표 기사에서 사실 후보를 뽑는다."""
    key = await get_service_key(db, "claude")
    if not key:
        return {"skipped": "no_key"}
    models = await config.get_models(db)
    q = select(NewsArticle).where(
        NewsArticle.summarized_at.is_not(None), NewsArticle.facts_extracted_at.is_(None),
        NewsArticle.is_hidden == False, NewsArticle.is_representative == True,  # noqa: E712
    )
    if company_id:
        q = q.where(NewsArticle.company_id == company_id)
    arts = (await db.execute(q.order_by(NewsArticle.published_at.desc().nullslast()).limit(limit))).scalars().all()
    by_company: dict[str, list[NewsArticle]] = defaultdict(list)
    now = now_kst()
    for a in arts:
        if a.issue_type in FACT_ISSUES or a.source_type == "dart":
            by_company[a.company_id].append(a)
        else:
            a.facts_extracted_at = now  # 사실이 나올 유형이 아니면 건너뜀 표시
    await db.commit()

    total = {"added": 0, "merged": 0, "rounds": 0, "failed": 0}
    for cid, items in by_company.items():
        company = await db.get(PortfolioCompany, cid)
        if not company:
            continue
        existing = list((await db.execute(select(CompanyFact).where(CompanyFact.company_id == cid))).scalars().all())
        for i in range(0, len(items), BATCH):
            chunk = items[i : i + BATCH]
            txt = "\n".join(
                f"[id={a.id}] ({a.published_at.date().isoformat() if a.published_at else '-'}, {a.issue_type or '-'}) {a.title} — {a.summary or ''}"
                for a in chunk
            )
            try:
                await release(db)
                r = await llm_client.claude_json(key[0], EXTRACT_PROMPT.format(name=company.name, articles=txt),
                                                 model=models["summary"], max_tokens=3000)
                data = r.data if isinstance(r.data, dict) else {"facts": r.data}
                s = await _apply(db, cid, data.get("facts") or [], {a.id: a for a in chunk}, existing)
                for k in ("added", "merged", "rounds"):
                    total[k] += s[k]
                for a in chunk:
                    a.facts_extracted_at = now_kst()
                await db.commit()
            except llm_client.LLMError as e:
                logger.warning("사실 추출 실패(%s): %s", company.name, e)
                await db.rollback()
                total["failed"] += len(chunk)
    return total


# --------------------------------------------------------------------------- 담당자 작업

async def set_status(db: AsyncSession, fact: CompanyFact, status: str, user_id: str) -> CompanyFact:
    fact.status = status
    if status == "confirmed":
        fact.confirmed_by, fact.confirmed_at = user_id, now_kst()
    await search.index_fact(db, fact)
    return fact


async def edit_fact(db: AsyncSession, fact: CompanyFact, changes: dict, user_id: str) -> CompanyFact:
    """수정은 새 행 + supersedes_id(이력 보존). 새 행은 확정 상태."""
    new = CompanyFact(
        company_id=fact.company_id, fact_type=changes.get("fact_type") or fact.fact_type,
        fact_date=changes.get("fact_date", fact.fact_date), title=(changes.get("title") or fact.title)[:300],
        detail=changes.get("detail", fact.detail), source_refs=fact.source_refs, status="confirmed",
        origin="manual", dedup_key=fact.dedup_key, confirmed_by=user_id, confirmed_at=now_kst(), supersedes_id=fact.id,
    )
    fact.status = "superseded"
    db.add(new)
    await db.flush()
    await search.index_fact(db, fact)
    await search.index_fact(db, new)
    return new


def fact_timeline(facts: list[CompanyFact]) -> list[dict]:
    """유형별 타임라인용 정렬(최신 먼저)."""
    return sorted(
        [{"id": f.id, "fact_type": f.fact_type, "type_label": FACT_TYPES.get(f.fact_type, f.fact_type),
          "fact_date": f.fact_date.isoformat() if f.fact_date else None, "title": f.title, "detail": f.detail or {},
          "source_refs": f.source_refs or [], "status": f.status, "origin": f.origin, "supersedes_id": f.supersedes_id,
          "confirmed_at": f.confirmed_at.isoformat() if f.confirmed_at else None}
         for f in facts],
        key=lambda x: (x["fact_date"] or "", x["title"]), reverse=True,
    )


def funding_out(r: CompanyFundingRound) -> dict:
    return {"id": r.id, "round_date": r.round_date.isoformat() if r.round_date else None, "round_name": r.round_name,
            "amount": r.amount, "currency": r.currency, "amount_disclosed": r.amount_disclosed,
            "investors": r.investors or [], "valuation": r.valuation, "is_follow_on": r.is_follow_on,
            "source_refs": r.source_refs or [], "status": r.status, "origin": r.origin}
