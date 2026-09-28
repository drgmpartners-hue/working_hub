"""기사 요약·태그(기획 9장 데일리 ③, F4).

대표 기사(is_representative)만 요약한다. 기업별로 최대 20건씩 묶어 요약 모델(Haiku)에 JSON으로 요청한다.
- summary: 1~2문장(80자 내외), 기사에 없는 내용 금지
- tag: positive / neutral / caution
- issue_type: 투자유치·실적·제품·수상·인사·제휴·규제·소송·공시·기타
- relevance: 0~100 (이 기업이 기사의 주인공인지). 30 미만이면 숨김 처리
"""
from __future__ import annotations

import logging
from collections import defaultdict
from datetime import datetime
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.news_briefing import NewsArticle, PortfolioCompany
from app.services import llm_client
from app.services.company_report import config
from app.services.company_report.keys import get_service_key
from app.services.company_report.timeutil import now_kst

logger = logging.getLogger(__name__)

BATCH = 20
HIDE_BELOW = 30
TAGS = {"positive", "neutral", "caution"}
ISSUE_TYPES = ["투자유치", "실적", "제품", "수상", "인사", "제휴", "규제", "소송", "공시", "기타"]

SUMMARY_PROMPT = """너는 벤처캐피탈 직원을 위한 뉴스 요약 담당이다.
대상 기업: {name} (업종: {industry}, 대표: {ceo})

아래 기사 목록(제목·본문 발췌)을 각각 요약하라.
규칙:
- summary: 한국어 1~2문장, 80자 내외. 두괄식. 기사에 없는 사실·숫자를 만들지 마라.
- tag: 기업 입장에서 positive(호재)/neutral(중립)/caution(주의: 소송·적자·규제·사고·부정 이슈) 중 하나.
- issue_type: {issue_types} 중 하나.
- relevance: 0~100. 이 기업이 기사의 주요 대상이면 70 이상, 단순 언급이면 30~60, 동명이인·다른 회사면 30 미만.

기사:
{articles}

출력 형식(JSON):
{{"items": [{{"id": "기사 id", "summary": "...", "tag": "neutral", "issue_type": "기타", "relevance": 80}}]}}
"""


def _fmt(arts: list[NewsArticle]) -> str:
    lines = []
    for a in arts:
        desc = (a.description or "").replace("\n", " ")[:300]
        day = a.published_at.strftime("%Y-%m-%d") if a.published_at else "-"
        lines.append(f"[id={a.id}] ({day}, {a.press or a.source}) {a.title}\n  {desc}")
    return "\n".join(lines)


def apply_result(arts: list[NewsArticle], items: list[dict], now: Optional[datetime] = None) -> int:
    """모델 응답을 기사에 반영. 반영 건수 반환(순수 로직, 테스트 대상)."""
    now = now or now_kst()
    by_id = {a.id: a for a in arts}
    done = 0
    for it in items or []:
        a = by_id.get(str(it.get("id", "")).strip())
        if not a:
            continue
        summary = str(it.get("summary") or "").strip()
        if not summary:
            continue
        tag = str(it.get("tag") or "neutral").strip().lower()
        issue = str(it.get("issue_type") or "기타").strip()
        a.summary = summary[:500]
        a.tag = tag if tag in TAGS else "neutral"
        a.issue_type = issue if issue in ISSUE_TYPES else "기타"
        a.summarized_at = now
        try:
            rel = int(it.get("relevance"))
        except (TypeError, ValueError):
            rel = None
        if rel is not None:
            # 규칙 점수와 AI 점수 중 낮은 쪽을 쓰지 않고 평균(규칙 과신 방지)
            a.relevance_score = int(((a.relevance_score or rel) + rel) / 2)
            if rel < HIDE_BELOW and a.source_type != "dart":
                a.is_hidden = True
                a.hidden_at = now
                a.hidden_by = "ai"
        done += 1
    return done


async def summarize_pending(db: AsyncSession, company_id: Optional[str] = None, limit: int = 200) -> dict:
    """요약이 없는 대표 기사를 요약한다."""
    key = await get_service_key(db, "claude")
    if not key:
        logger.warning("Claude 키가 없어 요약을 건너뜁니다.")
        return {"summarized": 0, "skipped": "no_key"}
    models = await config.get_models(db)

    q = select(NewsArticle).where(
        NewsArticle.summarized_at.is_(None),
        NewsArticle.is_representative == True,  # noqa: E712
        NewsArticle.is_hidden == False,  # noqa: E712
    )
    if company_id:
        q = q.where(NewsArticle.company_id == company_id)
    arts = (await db.execute(q.order_by(NewsArticle.published_at.desc().nullslast()).limit(limit))).scalars().all()

    grouped: dict[str, list[NewsArticle]] = defaultdict(list)
    for a in arts:
        grouped[a.company_id].append(a)

    total, failed = 0, 0
    for cid, items in grouped.items():
        company = await db.get(PortfolioCompany, cid)
        if not company:
            continue
        for i in range(0, len(items), BATCH):
            chunk = items[i : i + BATCH]
            try:
                r = await llm_client.claude_json(
                    key[0],
                    SUMMARY_PROMPT.format(
                        name=company.name, industry=company.industry or "-", ceo=company.ceo_name or "-",
                        issue_types=", ".join(ISSUE_TYPES), articles=_fmt(chunk),
                    ),
                    model=models["summary"], max_tokens=4000,
                )
                data = r.data if isinstance(r.data, dict) else {"items": r.data}
                total += apply_result(chunk, data.get("items") or [])
                await db.commit()
            except llm_client.LLMError as e:
                logger.warning("요약 실패(%s): %s", company.name, e)
                failed += len(chunk)
    return {"summarized": total, "failed": failed}
