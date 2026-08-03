"""테마 보고서 내러티브 생성 — 정량 데이터를 LLM(기존 AI설정, 현재 Gemini)으로 종합.

수집한 수치(흐름·수급·기여도·5축·뉴스)를 투입 → 9섹션 애널리스트 보고서(JSON) 생성.
환각 방지: 제공된 수치만 사용. 기존 ai_retirement_guide의 provider 분기/복호화 재사용.
"""
from __future__ import annotations

import json
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ai_setting import AIAPISetting
from app.core.security import decrypt_api_key
from app.services.ai_retirement_guide import call_gemini_api, call_claude_api
from app.services.collectors.key_access import get_user_key

logger = logging.getLogger(__name__)

_SECTION_KEYS = ["summary", "flow", "phase", "leaders", "supply", "axes_interp", "catalyst", "risk", "verdict"]

_SYSTEM = """당신은 한국 주식시장 테마를 분석하는 증권사 리서치 애널리스트입니다.
아래 '정량 데이터(JSON)'만 근거로, 투자 어드바이저가 이 테마를 포트폴리오에 담을지 판단할 수 있는
전문 보고서를 작성합니다.

원칙:
- 제공된 수치 외의 사실·종목·가격을 절대 지어내지 마세요(환각 금지). 데이터가 없으면 "데이터 없음"이라 쓰세요.
- 초보 어드바이저도 이해하도록 배경과 의미를 풀어서 설명하세요.
- 단정적 매수/매도 지시나 구체적 목표가·비중은 쓰지 마세요. 정성적 판단(담기/보류/관망)과 근거만.
- 한국어, 간결하지만 충실하게. 각 섹션은 2~5문장.

특히 'axes_interp'(5축 정밀 해석)는 각 축(모멘텀/수급/실적/관심도/밸류)마다:
(1) 이 축이 무엇을 측정하는지, (2) 점수가 높으면/낮으면 무슨 의미인지,
(3) 이 테마는 왜 이 점수인지(배경), (4) 어제 대비 증감이 있으면 그 변화의 의미를 설명하세요.
밸류 축은 '낮을수록 저평가(좋음)'인 역방향임을 명시하세요.

출력은 반드시 아래 키를 가진 JSON 객체만(코드펜스/설명 없이):
{
 "summary": "핵심 요약 — 결론 먼저, 지금 담을지",
 "flow": "다기간 흐름 해석(단기 vs 장기 정합성)",
 "phase": "국면·관심점수 진단",
 "leaders": "주도주 분석(대장주·기여도)",
 "supply": "수급 동향 해석(외국인/기관/개인 누가 사고 빼는지)",
 "axes_interp": "5축 정밀 해석(위 4요소 포함, 축별로)",
 "catalyst": "촉매·뉴스 흐름(무엇이 이 테마를 움직이나)",
 "risk": "리스크 점검",
 "verdict": "종합 판단(담기/보류/관망 + 근거)"
}"""


async def _call_active_ai(db: AsyncSession, user_id: str, prompt: str) -> str:
    """AI 키 우선순위: user_api_keys(gemini/claude) → ai_api_settings(레거시 은퇴설계용)."""
    # 1) 주식 기능과 동일 소스(user_api_keys)에서 Gemini/Claude 키
    gem = await get_user_key(db, user_id, "gemini")
    if gem and gem[0]:
        return await call_gemini_api(api_key=gem[0], prompt=prompt)
    for prov in ("anthropic", "claude"):
        cl = await get_user_key(db, user_id, prov)
        if cl and cl[0]:
            return await call_claude_api(api_key=cl[0], prompt=prompt)

    # 2) 레거시 폴백: ai_api_settings(글로벌)
    setting = (await db.execute(
        select(AIAPISetting).where(AIAPISetting.is_active == True)  # noqa: E712
    )).scalar_one_or_none()
    if setting is None:
        raise RuntimeError("AI 키 없음 (user_api_keys의 gemini/claude 또는 ai_api_settings 필요)")
    api_key = decrypt_api_key(setting.api_key_encrypted)
    if (setting.provider or "").lower() in ("anthropic", "claude"):
        return await call_claude_api(api_key=api_key, prompt=prompt)
    return await call_gemini_api(api_key=api_key, prompt=prompt)


def _strip_json(text: str) -> str:
    t = text.strip()
    if t.startswith("```"):
        t = t.split("```", 2)[1] if "```" in t[3:] else t.lstrip("`")
        if t.lstrip().startswith("json"):
            t = t.lstrip()[4:]
    # 첫 { ~ 마지막 }
    s, e = t.find("{"), t.rfind("}")
    return t[s:e + 1] if s >= 0 and e > s else t


async def generate_sections(db: AsyncSession, user_id: str, data: dict) -> dict:
    """정량 데이터 → 9섹션 내러티브(dict). 실패 시 빈 dict(폴백은 호출측에서)."""
    prompt = f"{_SYSTEM}\n\n[정량 데이터(JSON)]\n{json.dumps(data, ensure_ascii=False)}"
    try:
        raw = await _call_active_ai(db, user_id, prompt)
    except Exception as e:
        logger.warning("AI 보고서 생성 실패: %s", e)
        return {}
    try:
        parsed = json.loads(_strip_json(raw))
    except Exception as e:
        logger.warning("AI 응답 JSON 파싱 실패: %s", e)
        # 빈 dict 반환 → 호출측 안전망(_basic_sections) 발동.
        # (잘린 원문을 summary로 넘기면 안전망이 발동하지 않아 캐시가 오염됐음)
        return {}
    return {k: _coerce(parsed.get(k, "")) for k in _SECTION_KEYS}


_AXIS_KO = {"momentum": "모멘텀", "supply": "수급", "fundamentals": "실적", "attention": "관심도", "valuation": "밸류"}


def _coerce(v) -> str:
    """섹션 값이 dict/list로 와도 읽기 쉬운 문자열로 변환(프론트 깨짐 방지)."""
    if isinstance(v, str):
        return v
    if isinstance(v, dict):
        lines = []
        for k, sub in v.items():
            label = _AXIS_KO.get(k, k)
            if isinstance(sub, dict):
                body = " ".join(str(x) for x in sub.values() if x)
                lines.append(f"■ {label}: {body}")
            else:
                lines.append(f"■ {label}: {sub}")
        return "\n".join(lines)
    if isinstance(v, list):
        return "\n".join(str(x) for x in v)
    return str(v) if v is not None else ""
