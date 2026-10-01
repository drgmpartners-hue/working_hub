"""공용 LLM 호출 — Claude(Anthropic Messages API)·Gemini.

- JSON 출력 강제(코드펜스 제거 후 파싱), 429·5xx·파싱 실패 시 재시도
- 토큰 사용량 반환(ai_review_logs·비용 기록용)
- Claude 웹 검색/웹 페치 도구, Gemini Google 검색 그라운딩 옵션
기존 report_service._call_claude_haiku는 이 모듈의 claude_text를 쓰도록 바꾼다.
"""
from __future__ import annotations

import asyncio
import contextvars
import json
import logging
import re
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Iterator, Optional

import httpx

logger = logging.getLogger(__name__)

ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"

# 기본 모델(설정 화면·app_settings로 바꿀 수 있음)
DEFAULT_MAIN_MODEL = "claude-opus-5-5"      # 2차 검토(최종 판정)
DEFAULT_WRITER_MODEL = "claude-sonnet-5-5"  # 작성(초안·기업별 요약·사실 확인) — 비용 절감
DEFAULT_SUMMARY_MODEL = "claude-haiku-4-5"
DEFAULT_REVIEW_MODEL = "gemini-3.1-pro-preview"

WEB_SEARCH_TOOL = {"type": "web_search_20250305", "name": "web_search", "max_uses": 5}


class LLMError(RuntimeError):
    pass


# 프로세스 안 사용량 누적. company_report.usage.flush가 DB(app_settings)에 옮긴다.
# - _USAGE: 모델별 합계(예전 방식, 월별)
# - _STAGE_USAGE: (날짜, 단계, 모델)별 호출·토큰·검색 횟수 — 발송 설정의 'AI 비용' 카드
_USAGE: dict[str, dict[str, int]] = {}
_STAGE_USAGE: dict[str, dict[str, int]] = {}
_STAGE: contextvars.ContextVar[str] = contextvars.ContextVar("llm_stage", default="other")
_KST = timezone(timedelta(hours=9))


@contextmanager
def stage(name: str) -> Iterator[None]:
    """이 블록 안의 AI 호출을 name 단계로 기록한다(비동기 작업에도 이어짐)."""
    token = _STAGE.set(name)
    try:
        yield
    finally:
        _STAGE.reset(token)


def _record(model: str, usage: dict, searches: int = 0, stage_name: Optional[str] = None) -> None:
    u = _USAGE.setdefault(model or "unknown", {"calls": 0, "input": 0, "output": 0})
    u["calls"] += 1
    u["input"] += int(usage.get("input_tokens") or 0)
    u["output"] += int(usage.get("output_tokens") or 0)
    day = datetime.now(_KST).date().isoformat()
    k = f"{day}|{stage_name or _STAGE.get()}|{model or 'unknown'}"
    v = _STAGE_USAGE.setdefault(k, {"calls": 0, "input": 0, "output": 0, "searches": 0})
    v["calls"] += 1
    v["input"] += int(usage.get("input_tokens") or 0)
    v["output"] += int(usage.get("output_tokens") or 0)
    v["searches"] += int(searches or 0)


def drain_usage() -> dict[str, dict[str, int]]:
    """누적 사용량(모델별)을 꺼내고 비운다."""
    global _USAGE
    out, _USAGE = _USAGE, {}
    return out


def drain_stage_usage() -> dict[str, dict[str, int]]:
    """누적 사용량('날짜|단계|모델')을 꺼내고 비운다."""
    global _STAGE_USAGE
    out, _STAGE_USAGE = _STAGE_USAGE, {}
    return out


@dataclass
class LLMResult:
    text: str
    data: Any = None
    model: str = ""
    usage: dict = field(default_factory=dict)


_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.MULTILINE)


def parse_json(text: str) -> Any:
    """모델 출력에서 JSON을 꺼낸다. 코드펜스·앞뒤 설명문을 허용한다."""
    t = _FENCE_RE.sub("", text.strip()).strip()
    try:
        return json.loads(t)
    except json.JSONDecodeError:
        pass
    # 첫 { 또는 [ 부터 마지막 } 또는 ] 까지
    starts = [i for i in (t.find("{"), t.find("[")) if i >= 0]
    if not starts:
        raise LLMError("JSON을 찾을 수 없습니다")
    start = min(starts)
    end = max(t.rfind("}"), t.rfind("]"))
    if end <= start:
        raise LLMError("JSON 범위를 찾을 수 없습니다")
    try:
        return json.loads(t[start : end + 1])
    except json.JSONDecodeError as e:
        raise LLMError(f"JSON 파싱 실패: {e}") from e


async def claude_text(
    api_key: str,
    prompt: str,
    *,
    model: str = DEFAULT_SUMMARY_MODEL,
    system: Optional[str] = None,
    max_tokens: int = 2048,
    web_search: bool = False,
    timeout: float = 120,
    retries: int = 2,
    stage: Optional[str] = None,
) -> LLMResult:
    body: dict[str, Any] = {
        "model": model,
        "max_tokens": max_tokens,
        "messages": [{"role": "user", "content": prompt}],
    }
    if system:
        body["system"] = system
    if web_search:
        body["tools"] = [WEB_SEARCH_TOOL]
    headers = {
        "x-api-key": api_key,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
    }
    last_err: Exception | None = None
    for attempt in range(retries + 1):
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                res = await client.post(ANTHROPIC_URL, headers=headers, json=body)
            if res.status_code in (429, 500, 502, 503, 529):
                raise LLMError(f"Claude 일시 오류 {res.status_code}")
            if res.status_code >= 400:
                raise LLMError(f"Claude 오류 {res.status_code}: {res.text[:200]}")
            data = res.json()
            if data.get("stop_reason") == "refusal":
                raise LLMError("Claude가 요청을 거절했습니다")
            text = "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")
            usage = data.get("usage", {}) or {}
            searches = int(((usage.get("server_tool_use") or {}).get("web_search_requests")) or 0)
            _record(data.get("model", model), usage, searches, stage)
            return LLMResult(text=text, model=data.get("model", model), usage=usage)
        except (LLMError, httpx.HTTPError) as e:
            last_err = e
            msg = str(e)
            if attempt < retries and ("일시 오류" in msg or isinstance(e, httpx.HTTPError)):
                await asyncio.sleep(2 * (attempt + 1))
                continue
            break
    raise LLMError(str(last_err))


async def claude_pdf_text(api_key: str, pdf: bytes, prompt: str, *, model: str = DEFAULT_WRITER_MODEL,
                          max_tokens: int = 16000, timeout: float = 240, stage: Optional[str] = None) -> LLMResult:
    """PDF 를 그대로 보내 읽게 한다(스캔본·표 중심 문서, 기획 6장 '자료 읽기'). 32MB·100쪽 이하."""
    import base64

    body: dict[str, Any] = {
        "model": model,
        "max_tokens": max_tokens,
        "messages": [{"role": "user", "content": [
            {"type": "document", "source": {"type": "base64", "media_type": "application/pdf",
                                            "data": base64.b64encode(pdf).decode()}},
            {"type": "text", "text": prompt},
        ]}],
    }
    headers = {"x-api-key": api_key, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json"}
    async with httpx.AsyncClient(timeout=timeout) as client:
        res = await client.post(ANTHROPIC_URL, headers=headers, json=body)
    if res.status_code >= 400:
        raise LLMError(f"Claude 오류 {res.status_code}: {res.text[:200]}")
    data = res.json()
    text = "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")
    usage = data.get("usage", {}) or {}
    _record(data.get("model", model), usage, 0, stage)
    return LLMResult(text=text, model=data.get("model", model), usage=usage)


async def claude_images_json(api_key: str, images: list[tuple[bytes, str]], prompt: str, *,
                             model: str = DEFAULT_WRITER_MODEL, max_tokens: int = 3000, timeout: float = 180,
                             stage: Optional[str] = None) -> LLMResult:
    """그림 여러 장 + 질문 → JSON. images: [(바이트, 'image/png'|'image/jpeg'|…)] — 그림마다 앞에 '그림 N' 표시."""
    import base64

    content: list[dict] = []
    for i, (data, mt) in enumerate(images, start=1):
        content.append({"type": "text", "text": f"그림 {i}"})
        content.append({"type": "image", "source": {"type": "base64", "media_type": mt, "data": base64.b64encode(data).decode()}})
    content.append({"type": "text", "text": prompt})
    body: dict[str, Any] = {"model": model, "max_tokens": max_tokens, "messages": [{"role": "user", "content": content}],
                            "system": "반드시 유효한 JSON만 출력하라. 설명문·코드펜스를 붙이지 마라."}
    headers = {"x-api-key": api_key, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json"}
    async with httpx.AsyncClient(timeout=timeout) as client:
        res = await client.post(ANTHROPIC_URL, headers=headers, json=body)
    if res.status_code >= 400:
        raise LLMError(f"Claude 오류 {res.status_code}: {res.text[:200]}")
    data = res.json()
    text = "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")
    usage = data.get("usage", {}) or {}
    _record(data.get("model", model), usage, 0, stage)
    r = LLMResult(text=text, model=data.get("model", model), usage=usage)
    r.data = parse_json(text)
    return r


async def claude_json(api_key: str, prompt: str, **kwargs) -> LLMResult:
    """JSON만 출력하게 하고 파싱까지 한다. 파싱 실패 시 한 번 더 요청한다."""
    system = kwargs.pop("system", None) or ""
    system = (system + "\n\n반드시 유효한 JSON만 출력하라. 설명문·코드펜스를 붙이지 마라.").strip()
    last: Exception | None = None
    for _ in range(2):
        r = await claude_text(api_key, prompt, system=system, **kwargs)
        try:
            r.data = parse_json(r.text)
            return r
        except LLMError as e:
            last = e
    raise LLMError(f"Claude JSON 응답을 해석하지 못했습니다: {last}")


def _gemini_call(api_key: str, model: str, prompt: str, grounding: bool, want_json: bool) -> LLMResult:
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=api_key)
    cfg_kwargs: dict[str, Any] = {}
    if grounding:
        cfg_kwargs["tools"] = [types.Tool(google_search=types.GoogleSearch())]
    elif want_json:
        cfg_kwargs["response_mime_type"] = "application/json"
    resp = client.models.generate_content(
        model=model,
        contents=prompt,
        config=types.GenerateContentConfig(**cfg_kwargs) if cfg_kwargs else None,
    )
    usage = {}
    um = getattr(resp, "usage_metadata", None)
    if um is not None:
        usage = {
            "input_tokens": getattr(um, "prompt_token_count", None),
            "output_tokens": getattr(um, "candidates_token_count", None),
        }
    if grounding:  # 구글 검색 횟수(요금이 검색 건당 붙음)
        n = 0
        for c in getattr(resp, "candidates", None) or []:
            gm = getattr(c, "grounding_metadata", None)
            n += len(getattr(gm, "web_search_queries", None) or []) if gm else 0
        usage["searches"] = n or 1
    return LLMResult(text=resp.text or "", model=model, usage=usage)


async def gemini_json(
    api_key: str,
    prompt: str,
    *,
    model: str = DEFAULT_REVIEW_MODEL,
    grounding: bool = False,
    retries: int = 1,
    stage: Optional[str] = None,
) -> LLMResult:
    prompt = prompt + "\n\n반드시 유효한 JSON만 출력하라."
    last: Exception | None = None
    for attempt in range(retries + 1):
        try:
            r = await asyncio.to_thread(_gemini_call, api_key, model, prompt, grounding, True)
            _record(model, r.usage or {}, int((r.usage or {}).get("searches") or 0), stage)
            r.data = parse_json(r.text)
            return r
        except Exception as e:  # SDK 예외 종류가 다양함
            last = e
            logger.info("Gemini 호출 실패(%s회): %s", attempt + 1, e)
            await asyncio.sleep(2)
    raise LLMError(f"Gemini 호출 실패: {last}")
