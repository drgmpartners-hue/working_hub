"""사실 원장 자동 검증 — 사람이 기사를 읽고 [확정]/[제외]하던 일을 대신한다.

사실 후보마다 5가지를 확인한다.
① 원문 대조: 요약문이 아니라 기사 전문을 다시 읽고, 사실을 뒷받침하는 문장을 그대로 인용한다(숫자·날짜·상대방 일치)
② 주체 확인: 우리 투자기업의 일이 맞는지, 소송·분쟁이면 회사가 어느 쪽인지
③ 독립 출처 수: 같은 사건을 다룬 서로 다른 매체 수(중복 기사 묶음 포함)
④ 다른 AI의 검색 교차 확인: Gemini가 구글 검색으로 다른 출처를 직접 찾아 뒷받침·모순을 판단
⑤ 공식 기록: DART 공시가 출처면 '공식'

판정
- 자동 제외: 우리 회사 이야기가 아님 / 원문에 없음 / 전망·추측
- 자동 확정: 나머지. 표시는 공식(공시) · 출처 N곳 · 단일 출처(출처 1곳 — 담당자 결정: 큰 사실도 자동 확정)
- 확인 필요(후보로 남김): 다른 출처와 어긋남(모순) — 사람이 봐야 하는 유일한 경우
- 검증 AI 호출이 실패하면 다음 배치에서 다시(3번 실패하면 '검증 실패'로 후보 유지)
자동 판정은 언제든 담당자가 [되돌리기]/[제외]/[수정]할 수 있다.
"""
from __future__ import annotations

import logging
import re
from datetime import date
from typing import Any, Optional
from urllib.parse import urlparse

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.company_report import CompanyFact, CompanyFundingRound
from app.models.news_briefing import NewsArticle, PortfolioCompany
from app.services import llm_client
from app.services.company_report import article_reader, config, search
from app.services.company_report.keys import get_service_key, release
from app.services.company_report.timeutil import now_kst

logger = logging.getLogger(__name__)

AUTO_USER = "auto"
MAX_ATTEMPTS = 3
MAX_TEXT = 6000
FULLTEXT_ARTICLES = 2

CHECK_PROMPT = """너는 벤처캐피탈의 사실 검증 담당이다. 아래 '사실 후보'가 '기사 원문'에 실제로 쓰여 있는지 확인하라.
대상 기업: {name}{aliases}
사실 후보: ({fact_type}) {fact_date} — {title}
세부 내용: {detail}

[기사 원문]
{articles}

확인할 것
1. about_company: 이 사실의 주인공이 '{name}'이 맞는가(이름이 비슷한 다른 회사·거래 상대방·업계 일반 이야기면 false)
2. supported: 원문이 이 사실을 뒷받침하는가. yes(그대로 맞음) / partial(대체로 맞지만 숫자·날짜·상대방 등 일부가 다름) / no(원문에 없음·반대)
3. speculative: 확정된 사실이 아니라 계획·전망·추측·가능성('~할 예정', '~검토 중', '~전망')이면 true. 이미 체결·발표된 계획은 사실로 본다
4. quote: 근거가 되는 원문 문장을 한 글자도 바꾸지 말고 그대로(최대 2문장). 없으면 ""
5. role: 소송·분쟁·제재 사실이면 '{name}'이 원고/피고/신청인/피신청인/제재 대상/기타 중 무엇인지. 해당 없으면 ""
6. corrected: partial이면 원문에 맞게 고친 값 {{"title": "40자 이내", "fact_date": "YYYY-MM-DD", "detail": {{}}}}, 아니면 null
7. reason: 판단 이유 한 문장

출력 JSON
{{"about_company": true, "supported": "yes", "speculative": false, "quote": "...", "role": "", "corrected": null, "reason": "..."}}"""

SEARCH_PROMPT = """다음 주장이 사실인지 구글 검색으로 확인하라. 우리가 이미 가진 출처({known}) 말고, 다른 언론 기사·회사 발표·공시·정부 자료를 찾아라.
회사: {name}
주장: {fact_date} {title} ({detail})

판정
- corroborated: 다른 출처도 같은 내용을 전한다
- contradicted: 다른 출처가 다른 내용(숫자·날짜·당사자 등)을 명확히 전한다
- not_found: 다른 출처를 찾지 못했다

출력 JSON
{{"verdict": "corroborated|contradicted|not_found", "sources": [{{"press": "매체명", "title": "기사 제목", "url": "https://..."}}], "note": "한 문장"}}"""


# --------------------------------------------------------------------------- 순수 로직

def outlet_of(press: Optional[str], url: Optional[str]) -> str:
    """매체 구분 키: 매체명이 있으면 이름, 없으면 도메인(www 제외)."""
    p = re.sub(r"\s+", "", (press or "")).lower()
    if p:
        return p
    host = urlparse(url or "").netloc.lower()
    return host[4:] if host.startswith("www.") else host


def count_outlets(own: list[tuple[Optional[str], Optional[str]]], found: list[dict]) -> tuple[int, list[str]]:
    """우리 출처 + 검색으로 찾은 출처의 서로 다른 매체 수."""
    keys: list[str] = []
    for press, url in own:
        k = outlet_of(press, url)
        if k and k not in keys:
            keys.append(k)
    own_hosts = {urlparse(u or "").netloc.lower().removeprefix("www.") for _, u in own}
    for s in found or []:
        if not isinstance(s, dict):
            continue
        host = urlparse(str(s.get("url") or "")).netloc.lower().removeprefix("www.")
        if host and host in own_hosts:
            continue
        k = outlet_of(s.get("press"), s.get("url"))
        if k and k not in keys and "google" not in k and "vertexaisearch" not in k:
            keys.append(k)
    return len(keys), keys


def decide(check: dict, search_res: Optional[dict], official: bool, outlets: int) -> dict:
    """판정(순수 함수). 반환: {status, level, reason}
    status: confirmed / rejected / candidate(확인 필요)"""
    if check.get("about_company") is False:
        return {"status": "rejected", "level": "not_company", "reason": "우리 투자기업의 일이 아닙니다(다른 회사·상대방 이야기)."}
    sup = str(check.get("supported") or "").lower()
    if sup == "no":
        return {"status": "rejected", "level": "not_in_source", "reason": "기사 원문에 없는 내용입니다(요약 과정의 착오)."}
    if check.get("speculative") is True:
        return {"status": "rejected", "level": "speculative", "reason": "확정된 사실이 아니라 계획·전망입니다."}
    verdict = str((search_res or {}).get("verdict") or "").lower()
    if verdict == "contradicted" and not official:
        return {"status": "candidate", "level": "conflict",
                "reason": "다른 출처와 내용이 어긋납니다. 아래 근거를 보고 결정해 주세요."}
    if official:
        return {"status": "confirmed", "level": "official", "reason": "DART 공시로 확인했습니다."}
    if outlets >= 2:
        return {"status": "confirmed", "level": "multi", "reason": f"서로 다른 {outlets}개 출처가 같은 내용을 전합니다."}
    return {"status": "confirmed", "level": "single", "reason": "출처가 1곳입니다(원문 인용·주체 확인은 통과)."}


def label_of(v: Optional[dict]) -> str:
    v = v or {}
    lv = v.get("level")
    return {
        "official": "공식(공시)", "multi": f"출처 {v.get('outlets', 2)}곳", "single": "단일 출처",
        "conflict": "출처 어긋남", "not_company": "다른 회사 이야기", "not_in_source": "원문에 없음",
        "speculative": "전망·추측", "error": "검증 실패",
    }.get(lv or "", "")


# --------------------------------------------------------------------------- 실행

async def _sources(db: AsyncSession, fact: CompanyFact) -> tuple[list[NewsArticle], list[NewsArticle]]:
    """(근거 기사, 같은 사건 묶음의 다른 매체 기사)"""
    ids = [r.get("article_id") for r in fact.source_refs or [] if isinstance(r, dict) and r.get("article_id")]
    if not ids:
        return [], []
    arts = list((await db.execute(select(NewsArticle).where(NewsArticle.id.in_(ids)))).scalars().all())
    groups = {a.dup_group_id for a in arts if a.dup_group_id}
    sib: list[NewsArticle] = []
    if groups:
        sib = list((await db.execute(select(NewsArticle).where(
            NewsArticle.dup_group_id.in_(list(groups)), NewsArticle.id.not_in(ids)))).scalars().all())
    return arts, sib


async def _article_texts(arts: list[NewsArticle]) -> str:
    parts = []
    for i, a in enumerate(arts, 1):
        body = ""
        if i <= FULLTEXT_ARTICLES and a.source_type != "dart":
            r = await article_reader.read(a.url)
            if r.get("ok"):
                body = "\n".join(r.get("paragraphs") or [])
        if not body:
            body = " ".join(x for x in [a.description, a.summary] if x)
        d = a.published_at.date().isoformat() if a.published_at else "-"
        parts.append(f"[기사{i}] {a.press or ''} {d} {a.title}\n{body[:MAX_TEXT // max(1, min(len(arts), 3))]}")
    return "\n\n".join(parts)[:MAX_TEXT + 1000]


async def verify_fact(db: AsyncSession, fact: CompanyFact, company: PortfolioCompany, claude_key: str,
                      gemini_key: Optional[str], models: dict[str, str]) -> dict:
    arts, sib = await _sources(db, fact)
    official = any(a.source_type == "dart" for a in arts + sib)
    own = [(a.press, a.url) for a in arts + sib if a.source_type != "dart"]
    detail = ", ".join(f"{k}: {v}" for k, v in (fact.detail or {}).items() if v not in (None, "", [], {}))[:400] or "-"
    fdate = fact.fact_date.isoformat() if fact.fact_date else "날짜 미상"
    await release(db)

    articles_txt = await _article_texts(arts[:3]) if arts else "(근거 기사 없음 — 담당자가 직접 입력한 사실)"
    aliases = [x for x in (company.aliases or []) if x]
    prompt = CHECK_PROMPT.format(name=company.name, aliases=f" (다른 이름: {', '.join(aliases)})" if aliases else "",
                                 fact_type=fact.fact_type, fact_date=fdate, title=fact.title, detail=detail,
                                 articles=articles_txt)
    r = await llm_client.claude_json(claude_key, prompt, model=models["writer"], max_tokens=1200, stage="verify")
    check = r.data if isinstance(r.data, dict) else {}

    search_res: Optional[dict] = None
    if gemini_key and check.get("about_company") is not False and str(check.get("supported") or "").lower() != "no" and not official:
        known = ", ".join(sorted({outlet_of(p, u) for p, u in own})) or "없음"
        try:
            g = await llm_client.gemini_json(gemini_key, SEARCH_PROMPT.format(
                known=known, name=company.name, fact_date=fdate, title=fact.title, detail=detail),
                model=models["review"], grounding=True, stage="verify")
            search_res = g.data if isinstance(g.data, dict) else None
        except llm_client.LLMError as e:
            logger.info("사실 검색 교차 확인 실패(%s): %s", fact.title, e)

    found = (search_res or {}).get("sources") if (search_res or {}).get("verdict") == "corroborated" else []
    n_out, outlet_keys = count_outlets(own, found or [])
    res = decide(check, search_res, official, n_out)
    return {
        **res, "outlets": n_out, "outlet_names": outlet_keys[:10], "official": official,
        "quote": str(check.get("quote") or "")[:600], "role": str(check.get("role") or "")[:40],
        "supported": check.get("supported"), "check_reason": str(check.get("reason") or "")[:300],
        "corrected": check.get("corrected") if isinstance(check.get("corrected"), dict) else None,
        "search": {"verdict": (search_res or {}).get("verdict"), "note": str((search_res or {}).get("note") or "")[:300],
                   "sources": [s for s in ((search_res or {}).get("sources") or []) if isinstance(s, dict)][:5]}
        if search_res else None,
        "checked_at": now_kst().isoformat(timespec="seconds"), "model": models["writer"],
    }


def _apply_correction(fact: CompanyFact, corrected: Optional[dict]) -> Optional[dict]:
    """partial(일부 다름)이면 원문에 맞게 고친다. 고치기 전 값은 verification.original에 남긴다."""
    if not corrected:
        return None
    original = {"title": fact.title, "fact_date": fact.fact_date.isoformat() if fact.fact_date else None, "detail": fact.detail}
    t = str(corrected.get("title") or "").strip()
    if t:
        fact.title = t[:300]
    d = corrected.get("fact_date")
    if isinstance(d, str) and re.match(r"^\d{4}-\d{2}-\d{2}$", d):
        try:
            fact.fact_date = date.fromisoformat(d)
        except ValueError:
            pass
    if isinstance(corrected.get("detail"), dict) and corrected["detail"]:
        fact.detail = {**(fact.detail or {}), **corrected["detail"]}
    return original


async def _save(db: AsyncSession, fact: CompanyFact, v: dict) -> None:
    status = v["status"]
    if status == "confirmed" and str(v.get("supported") or "").lower() == "partial":
        orig = _apply_correction(fact, v.get("corrected"))
        if orig:
            v["original"] = orig
    fact.verification = v
    fact.verified_at = now_kst()
    fact.status = status
    if status == "confirmed":
        fact.confirmed_by, fact.confirmed_at = AUTO_USER, now_kst()
    # 투자유치 기록도 같은 판정
    if fact.fact_type == "funding":
        for r in (await db.execute(select(CompanyFundingRound).where(CompanyFundingRound.fact_id == fact.id))).scalars():
            if r.status == "candidate" and status in ("confirmed", "rejected"):
                r.status = status
                if status == "confirmed":
                    r.confirmed_by, r.confirmed_at = AUTO_USER, now_kst()
                await search.index_funding(db, r)
    await search.index_fact(db, fact)


async def verify_pending(db: AsyncSession, company_id: Optional[str] = None, limit: int = 40,
                         include_verified_candidates: bool = False) -> dict:
    """아직 검증하지 않은 AI 후보 사실을 검증한다(최신 먼저)."""
    claude = await get_service_key(db, "claude")
    if not claude:
        return {"skipped": "no_key"}
    gemini = await get_service_key(db, "gemini")
    models = await config.get_models(db)
    cond = [CompanyFact.status == "candidate", CompanyFact.origin == "ai"]
    if not include_verified_candidates:
        cond.append(or_(CompanyFact.verified_at.is_(None),
                        CompanyFact.verification["level"].astext == "error"))
    if company_id:
        cond.append(CompanyFact.company_id == company_id)
    facts = (await db.execute(select(CompanyFact).where(*cond)
                              .order_by(CompanyFact.fact_date.desc().nullslast()).limit(limit))).scalars().all()
    stats = {"confirmed": 0, "rejected": 0, "candidate": 0, "error": 0}
    companies: dict[str, PortfolioCompany] = {}
    for f in facts:
        attempts = int((f.verification or {}).get("attempts") or 0)
        if (f.verification or {}).get("level") == "error" and attempts >= MAX_ATTEMPTS:
            continue
        c = companies.get(f.company_id) or await db.get(PortfolioCompany, f.company_id)
        if not c:
            continue
        companies[c.id] = c
        fid = f.id
        try:
            v = await verify_fact(db, f, c, claude[0], gemini[0] if gemini else None, models)
            f = await db.get(CompanyFact, fid)
            await _save(db, f, v)
            stats[v["status"]] += 1
        except Exception as e:  # noqa: BLE001 — 한 건 실패가 전체를 멈추지 않게
            logger.warning("사실 검증 실패(%s): %s", f.title, e)
            await db.rollback()
            f = await db.get(CompanyFact, fid)
            f.verification = {"level": "error", "status": "candidate", "attempts": attempts + 1,
                              "reason": "자동 검증에 실패해 다음 배치에서 다시 확인합니다." if attempts + 1 < MAX_ATTEMPTS
                              else "자동 검증에 여러 번 실패했습니다. 직접 확인해 주세요.",
                              "checked_at": now_kst().isoformat(timespec="seconds")}
            f.verified_at = now_kst()
            stats["error"] += 1
        await db.commit()
    return {**stats, "checked": len(facts)}
