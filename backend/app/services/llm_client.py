"""공용 LLM 호출 — Claude(Anthropic Messages API)·Gemini.

- JSON 출력 강제(코드펜스 제거 후 파싱), 429·5xx·파싱 실패 시 재시도
- 토큰 사용량 반환(ai_review_logs·비용 기록용)
- Claude 웹 검색/웹 페치 도구, Gemini Google 검색 그라운딩 옵션
기존 report_service._call_claude_haiku는 이 모듈의 claude_text를 쓰도록 바꾼다.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)

ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"

# 기본 모델(설정 화면·app_settings로 바꿀 수 있음)
DEFAULT_MAIN_MODEL = "claude-opus-5"
DEFAULT_SUMMARY_MODEL = "claude-haiku-4-5"
DEFAULT_REVIEW_MODEL = "gemini-3.1-pro-preview"

WEB_SEARCH_TOOL = {"type": "web_search_20250305", "name": "web_search", "max_uses": 5}


class LLMError(RuntimeError):
    pass


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
            return LLMResult(text=text, model=data.get("model", model), usage=usage)
        except (LLMError, httpx.HTTPError) as e:
            last_err = e
            msg = str(e)
            if attempt < retries and ("일시 오류" in msg or isinstance(e, httpx.HTTPError)):
                await asyncio.sleep(2 * (attempt + 1))
                continue
            break
    raise LLMError(str(last_err))


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
    return LLMResult(text=resp.text or "", model=model, usage=usage)


async def gemini_json(
    api_key: str,
    prompt: str,
    *,
    model: str = DEFAULT_REVIEW_MODEL,
    grounding: bool = False,
    retries: int = 1,
) -> LLMResult:
    prompt = prompt + "\n\n반드시 유효한 JSON만 출력하라."
    last: Exception | None = None
    for attempt in range(retries + 1):
        try:
            r = await asyncio.to_thread(_gemini_call, api_key, model, prompt, grounding, True)
            r.data = parse_json(r.text)
            return r
        except Exception as e:  # SDK 예외 종류가 다양함
            last = e
            logger.info("Gemini 호출 실패(%s회): %s", attempt + 1, e)
            await asyncio.sleep(2)
    raise LLMError(f"Gemini 호출 실패: {last}")
