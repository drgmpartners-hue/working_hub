"""기업 등록 — 검색어 → 후보 카드 → [반영]/[다시 찾기], 키워드 제안, 검색 미리보기 (기획 3장 F1)."""
from __future__ import annotations

import asyncio
import logging
from datetime import timedelta
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.services import llm_client
from app.services.collectors import naver_news_client as naver
from app.services.collectors.dart_client import DARTClient, normalize_corp_name
from app.services.company_report import config
from app.services.company_report.dedup import relevance
from app.services.company_report.keys import get_service_key, release
from app.services.company_report.timeutil import now_kst

logger = logging.getLogger(__name__)

_CORP_CLS = {"Y": "유가증권", "K": "코스닥", "N": "코넥스", "E": "기타"}


def _fmt_date(yyyymmdd: str) -> Optional[str]:
    if yyyymmdd and len(yyyymmdd) == 8 and yyyymmdd.isdigit():
        return f"{yyyymmdd[:4]}-{yyyymmdd[4:6]}-{yyyymmdd[6:]}"
    return None


def _card_from_dart(info: dict, base: dict) -> dict:
    cls = info.get("corp_cls") or ""
    return {
        "source": "dart",
        "name": info.get("corp_name") or base.get("corp_name"),
        "name_en": info.get("corp_name_eng") or base.get("corp_eng_name") or None,
        "corp_code": base.get("corp_code"),
        "stock_code": (info.get("stock_code") or base.get("stock_code") or "").strip() or None,
        "is_listed": cls in ("Y", "K", "N"),
        "market": _CORP_CLS.get(cls),
        "ceo_name": info.get("ceo_nm"),
        "established_at": _fmt_date(info.get("est_dt", "")),
        "address": info.get("adres"),
        "homepage": info.get("hm_url"),
        "industry": info.get("induty_code"),
        "biz_reg_no": info.get("bizr_no"),
        "evidence": [],
    }


async def _news(db: AsyncSession, query: str, display: int = 30) -> list[dict]:
    key = await get_service_key(db, "naver_search")
    if not key:
        return []
    try:
        await release(db)
        page = await naver.search_page(key[0], key[1], query, display=display, sort="sim")
        return page["items"]
    except Exception as e:
        logger.info("네이버 검색 실패: %s", e)
        return []


def _evidence_for(name: str, items: list[dict], n: int = 3) -> list[dict]:
    key = normalize_corp_name(name)
    out = []
    for it in items:
        if key and key in normalize_corp_name(it["title"] + it["description"]):
            out.append({
                "title": it["title"],
                "url": it["url"],
                "date": it["published_at"].strftime("%Y-%m-%d") if it["published_at"] else None,
            })
        if len(out) >= n:
            break
    return out


WEB_CANDIDATE_PROMPT = """다음 검색어에 해당하는 한국 회사 후보를 웹에서 찾아라: "{query}"
검색어는 회사명·제품명·대표자명일 수 있다. 실제로 확인되는 회사만, 최대 3곳.
각 회사에 대해 공개 자료로 확인한 값만 채우고 모르면 null로 둔다.
출력 JSON: {{"candidates": [{{"name": "정식 회사명", "name_en": null, "ceo_name": null, "established_at": "YYYY-MM-DD 또는 null",
"address": null, "homepage": null, "industry": null, "evidence": [{{"title": "근거 페이지 제목", "url": "주소"}}]}}]}}"""


async def search_candidates(db: AsyncSession, query: str, user_id: Optional[str] = None) -> dict:
    """검색어로 후보 카드 목록을 만든다. DART → 뉴스 근거, DART에 없으면 Claude 웹 검색."""
    query = (query or "").strip()
    if not query:
        return {"query": query, "candidates": []}
    cards: list[dict] = []
    notice: Optional[str] = None

    dart_key = await get_service_key(db, "dart", user_id)
    if dart_key:
        client = DARTClient(dart_key[0])
        try:
            await release(db)
            found = await client.search_corps(query, limit=5)
        except Exception as e:
            logger.info("DART 회사 검색 실패: %s", e)
            found = []
        if found:
            await release(db)
            infos = await asyncio.gather(*(client.get_company(b["corp_code"]) for b in found[:4]), return_exceptions=True)
            for base, info in zip(found[:4], infos):
                cards.append(_card_from_dart(info if isinstance(info, dict) else {}, base))

    news = await _news(db, query)
    for c in cards:
        c["evidence"] = _evidence_for(c["name"] or "", news)

    if not cards:
        claude = await get_service_key(db, "claude", user_id)
        if claude:
            models = await config.get_models(db)
            try:
                await release(db)
                # 웹 검색은 오래 걸릴 수 있어 60초에서 끊는다(화면이 응답 없이 끊기지 않게)
                r = await asyncio.wait_for(llm_client.claude_json(
                    claude[0], WEB_CANDIDATE_PROMPT.format(query=query),
                    model=models["summary"], web_search=True, max_tokens=2000, timeout=55, retries=0,
                ), timeout=60)
                for c in (r.data or {}).get("candidates", [])[:3]:
                    c.update({"source": "web", "corp_code": None, "stock_code": None, "is_listed": False})
                    if not c.get("evidence"):
                        c["evidence"] = _evidence_for(c.get("name") or "", news)
                    cards.append(c)
            except asyncio.TimeoutError:
                notice = "웹 검색이 60초 안에 끝나지 않았습니다. 검색어를 바꿔 [다시 찾기]를 누르거나 [직접 등록]을 쓰세요."
            except llm_client.LLMError as e:
                logger.info("웹 후보 검색 실패: %s", e)
                notice = f"웹 검색 실패: {e}"

    # 이름이 뉴스 근거와 맞는 후보를 앞으로
    cards.sort(key=lambda c: -len(c.get("evidence") or []))
    return {"query": query, "candidates": cards, "notice": notice}


KEYWORD_PROMPT = """투자기업 뉴스 모니터링용 검색 키워드를 제안하라.
회사: {name} (영문 {name_en}), 대표자: {ceo}, 업종: {industry}
최근 뉴스 제목(이 회사와 무관한 동명 기사가 섞여 있을 수 있음):
{titles}

규칙
- required(필수어): 기사에 이 중 하나가 있어야 수집. 정식명·영문명·자주 쓰는 약칭. 2~4개
- boost(보조어): 대표자명, 주력 제품·서비스명 등 이 회사 기사임을 뒷받침하는 단어. 3~6개
- exclude(제외어): 위 제목에서 보이는 동명 회사·동명이인·무관한 뜻 등 오탐 원인. 0~5개
출력 JSON: {{"required": [], "boost": [], "exclude": [], "notes": "짧은 설명"}}"""


async def suggest_keywords(db: AsyncSession, company: dict, user_id: Optional[str] = None) -> dict:
    name = (company.get("name") or "").strip()
    base = {"required": [name] if name else [], "boost": [x for x in [company.get("ceo_name")] if x], "exclude": []}
    if company.get("name_en"):
        base["required"].append(company["name_en"])
    claude = await get_service_key(db, "claude", user_id)
    if not claude or not name:
        return {**base, "notes": "AI 키가 없어 기본 키워드만 제안했습니다."}
    news = await _news(db, name, display=30)
    titles = "\n".join(f"- {n['title']}" for n in news[:30]) or "(검색 결과 없음)"
    models = await config.get_models(db)
    try:
        await release(db)
        r = await llm_client.claude_json(
            claude[0],
            KEYWORD_PROMPT.format(
                name=name, name_en=company.get("name_en") or "-", ceo=company.get("ceo_name") or "-",
                industry=company.get("industry") or "-", titles=titles,
            ),
            model=models["summary"], max_tokens=800,
        )
        d = r.data or {}
        out = {k: [str(x).strip() for x in (d.get(k) or []) if str(x).strip()] for k in ("required", "boost", "exclude")}
        if name and name not in out["required"]:
            out["required"].insert(0, name)
        out["notes"] = d.get("notes", "")
        return out
    except llm_client.LLMError as e:
        return {**base, "notes": f"AI 제안 실패: {e}"}


async def preview_search(db: AsyncSession, required: list[str], boost: list[str], exclude: list[str],
                         days: int = 7) -> dict:
    """저장 전 미리보기 — 최근 N일 기사 수와 샘플 10건의 통과·제외 여부."""
    key = await get_service_key(db, "naver_search")
    if not key:
        return {"count_passed": 0, "count_total": 0, "samples": [], "warning": "네이버 검색 키가 없습니다."}
    since = now_kst() - timedelta(days=days)
    seen: set[str] = set()
    rows: list[dict] = []
    for q in required[:4]:
        try:
            await release(db)
            res = await naver.search_since(key[0], key[1], q, since, max_items=300)
        except Exception as e:
            logger.info("미리보기 검색 실패(%s): %s", q, e)
            continue
        for it in res["items"]:
            if it["url"] in seen:
                continue
            seen.add(it["url"])
            rel = relevance(it["title"], it["description"], required, boost, exclude)
            rows.append({
                "title": it["title"], "url": it["url"], "press": it["press"],
                "date": it["published_at"].strftime("%Y-%m-%d %H:%M") if it["published_at"] else None,
                "passed": not rel.excluded, "score": rel.score, "reason": rel.reason,
            })
    rows.sort(key=lambda r: r["date"] or "", reverse=True)
    passed = [r for r in rows if r["passed"]]
    # 샘플: 통과 7 + 제외 3 (있는 만큼)
    samples = passed[:7] + [r for r in rows if not r["passed"]][:3]
    return {"days": days, "count_total": len(rows), "count_passed": len(passed), "samples": samples[:10]}
