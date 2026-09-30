"""교차 검토 엔진 — Claude 작성 → Gemini 1차 검토 → Claude 2차 검토(새 호출).

기획 5장. 데일리·월간·반기 보고서 공통으로 쓴다.

입력 형식
- sources: [{"id": "a1", "text": "..."}]  ← 기사 제목·요약문, 원장 사실 등 근거
- sentences: [{"id": "s1", "section": "overall", "text": "...", "source_ids": ["a1"]}]

규칙
- 1차(Gemini)가 remove, 2차(Claude)가 keep → 합의 안 됨
  · mode="briefing": 삭제  · mode="report": 남기되 disputed 표시(담당자 확인)
- 2차가 remove → 삭제, fix → final_text로 교체
- 모든 단계 결과는 ai_review_logs에 남긴다
"""
from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass, field
from typing import Any, Literal, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.news_briefing import AIReviewLog
from app.services import llm_client
from app.services.company_report.keys import release

logger = logging.getLogger(__name__)

Mode = Literal["briefing", "report"]

REVIEW1_PROMPT = """당신은 금융회사의 사실 검증 담당자입니다. 아래 '근거 자료'만을 기준으로 '검토 대상 문장'을 한 문장씩 점검하세요.

점검 기준
1. 근거 자료와 다른 사실(숫자·날짜·이름·사건)
2. 근거 없는 추측이나 과장, 투자 권유로 읽히는 표현
3. 문장끼리의 모순, 논리 비약
4. 근거 자료에 있는 중요한 사실이 빠졌는지(missing에 적기)

출력 JSON 형식:
{{"reviews": [{{"id": "문장id", "verdict": "keep|fix|remove", "issue": "문제 설명(없으면 빈 문자열)", "suggestion": "fix일 때 고친 문장"}}],
  "missing": ["빠진 중요한 사실(근거 id 포함)"]}}

[근거 자료]
{sources}

[검토 대상 문장]
{sentences}
"""

REVIEW2_PROMPT = """당신은 최종 검토자입니다. 1차 검토자의 의견을 판정해 최종 문장을 확정하세요.
판단은 반드시 '근거 자료'에 근거해야 합니다. 1차 의견이 근거와 맞지 않으면 기각하고 이유를 쓰세요.
문장은 두괄식, 한 문장에 한 내용, 쉬운 말로 쓰고, 투자 권유·수익 보장 표현은 쓰지 마세요.

출력 JSON 형식:
{{"final": [{{"id": "문장id", "decision": "keep|fix|remove", "final_text": "최종 문장(remove면 빈 문자열)", "source_ids": ["근거id"], "reason": "판정 이유"}}]}}

[근거 자료]
{sources}

[검토 대상 문장]
{sentences}

[1차 검토 의견]
{review1}
"""


@dataclass
class ReviewOutcome:
    sentences: list[dict]                 # 최종 문장(삭제된 것 제외, report 모드에선 disputed 포함)
    removed: list[dict] = field(default_factory=list)
    disputed: list[dict] = field(default_factory=list)
    missing: list[str] = field(default_factory=list)
    review1_ok: bool = True
    review2_ok: bool = True
    summary: dict = field(default_factory=dict)


def _fmt_sources(sources: list[dict]) -> str:
    return "\n".join(f"[{s['id']}] {s['text']}" for s in sources)


def _fmt_sentences(sentences: list[dict]) -> str:
    return "\n".join(
        f"[{s['id']}] ({s.get('section', '')}) {s['text']}  ← 근거: {', '.join(s.get('source_ids') or []) or '없음'}"
        for s in sentences
    )


def _hash(obj: Any) -> str:
    return hashlib.sha256(json.dumps(obj, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


async def _log(db: AsyncSession, target_type: str, target_id: Optional[str], stage: str,
               result: Optional[llm_client.LLMResult], model: str, input_obj: Any, summary: dict | None = None) -> None:
    db.add(AIReviewLog(
        target_type=target_type,
        target_id=target_id,
        stage=stage,
        model=(result.model if result else model) or model,
        input_hash=_hash(input_obj),
        output=result.data if result and isinstance(result.data, (dict, list)) else ({"text": result.text[:4000]} if result else None),
        verdict_summary=summary,
        tokens=result.usage if result else None,
    ))


def merge_reviews(sentences: list[dict], review1: dict | None, review2: dict | None, mode: Mode) -> ReviewOutcome:
    """1·2차 결과를 합쳐 최종 문장을 만든다(순수 함수 — 테스트 대상)."""
    r1 = {r.get("id"): r for r in (review1 or {}).get("reviews", []) if isinstance(r, dict)}
    r2 = {r.get("id"): r for r in (review2 or {}).get("final", []) if isinstance(r, dict)}
    out = ReviewOutcome(sentences=[], missing=list((review1 or {}).get("missing", []) or []))
    for s in sentences:
        sid = s["id"]
        v1 = (r1.get(sid) or {}).get("verdict", "keep")
        d2 = r2.get(sid)
        decision = (d2 or {}).get("decision", "keep" if review2 is not None else v1)
        if decision == "remove":
            out.removed.append({**s, "reason": (d2 or {}).get("reason") or (r1.get(sid) or {}).get("issue", "")})
            continue
        text = s["text"]
        if decision == "fix":
            text = (d2 or {}).get("final_text") or (r1.get(sid) or {}).get("suggestion") or text
        new = {**s, "text": text, "source_ids": (d2 or {}).get("source_ids") or s.get("source_ids") or []}
        if v1 == "remove" and decision in ("keep", "fix"):
            # 합의 안 됨
            item = {**new, "review1_issue": (r1.get(sid) or {}).get("issue", ""), "review2_reason": (d2 or {}).get("reason", "")}
            out.disputed.append(item)
            if mode == "briefing":
                out.removed.append({**s, "reason": "교차 검토 불합의"})
                continue
            new["disputed"] = True
        if not new.get("source_ids"):
            # 근거 없는 사실 문장은 쓰지 않는다
            out.removed.append({**s, "reason": "근거 없음"})
            continue
        out.sentences.append(new)
    total = len(sentences) or 1
    out.summary = {
        "total": len(sentences),
        "kept": len(out.sentences),
        "removed": len(out.removed),
        "disputed": len(out.disputed),
        "removed_ratio": round(len(out.removed) / total, 3),
    }
    return out


async def review_sentences(
    db: AsyncSession,
    *,
    sources: list[dict],
    sentences: list[dict],
    claude_key: str,
    gemini_key: Optional[str],
    models: dict[str, str],
    target_type: str,
    target_id: Optional[str] = None,
    mode: Mode = "briefing",
    grounding: bool = False,
) -> ReviewOutcome:
    """작성된 문장을 1·2차 검토한다(작성 단계는 호출자가 수행하고 draft 로그를 남긴다)."""
    src_txt, sen_txt = _fmt_sources(sources), _fmt_sentences(sentences)

    review1: dict | None = None
    r1_ok = True
    if gemini_key:
        p1 = REVIEW1_PROMPT.format(sources=src_txt, sentences=sen_txt)
        try:
            await release(db)
            r1 = await llm_client.gemini_json(gemini_key, p1, model=models["review"], grounding=grounding, stage="review1")
            review1 = r1.data if isinstance(r1.data, dict) else {"reviews": r1.data}
            await _log(db, target_type, target_id, "review1", r1, models["review"], p1)
        except llm_client.LLMError as e:
            r1_ok = False
            logger.warning("1차 검토(Gemini) 실패: %s", e)
            await _log(db, target_type, target_id, "review1", None, models["review"], p1, {"error": str(e)})
    else:
        r1_ok = False

    p2 = REVIEW2_PROMPT.format(
        sources=src_txt, sentences=sen_txt,
        review1=json.dumps(review1, ensure_ascii=False) if review1 else "(1차 검토 없음 — 직접 전부 검증할 것)",
    )
    review2: dict | None = None
    r2_ok = True
    try:
        await release(db)
        r2 = await llm_client.claude_json(claude_key, p2, model=models["main"], max_tokens=8000, stage="review2")
        review2 = r2.data if isinstance(r2.data, dict) else {"final": r2.data}
        await _log(db, target_type, target_id, "review2", r2, models["main"], p2)
    except llm_client.LLMError as e:
        r2_ok = False
        logger.warning("2차 검토(Claude) 실패: %s", e)
        await _log(db, target_type, target_id, "review2", None, models["main"], p2, {"error": str(e)})

    outcome = merge_reviews(sentences, review1, review2, mode)
    outcome.review1_ok, outcome.review2_ok = r1_ok, r2_ok
    outcome.summary.update({"review1_ok": r1_ok, "review2_ok": r2_ok})
    return outcome


async def log_draft(db: AsyncSession, target_type: str, target_id: Optional[str],
                    result: llm_client.LLMResult, model: str, prompt: str) -> None:
    await _log(db, target_type, target_id, "draft", result, model, prompt)
