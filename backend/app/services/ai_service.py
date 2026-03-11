"""AI service using Google Gemini API for text generation, analysis, and image creation."""
from __future__ import annotations

import base64
import logging
import os
import uuid
from typing import Optional

from google import genai
from google.genai import types
from app.core.config import settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Gemini client setup
# ---------------------------------------------------------------------------

_client: genai.Client | None = None

IMAGE_OUTPUT_DIR = "generated_images"


def _get_client() -> genai.Client:
    """Lazy-init Gemini client."""
    global _client
    if _client is None:
        if not settings.GEMINI_API_KEY:
            raise RuntimeError("GEMINI_API_KEY is not configured")
        _client = genai.Client(api_key=settings.GEMINI_API_KEY)
    return _client


def _call_gemini(prompt: str) -> str:
    """Call Gemini text model and return response."""
    try:
        client = _get_client()
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
        )
        return response.text
    except Exception as e:
        logger.error("Gemini API error: %s", e)
        return f"[AI 응답 실패: {e}]"


def _generate_image(prompt: str, filename_prefix: str = "image") -> Optional[str]:
    """Generate an image using Gemini Imagen model. Returns saved file path or None."""
    try:
        client = _get_client()
        response = client.models.generate_images(
            model="imagen-4.0-generate-001",
            prompt=prompt,
            config=types.GenerateImagesConfig(
                number_of_images=1,
                aspect_ratio="16:9",
            ),
        )

        if response.generated_images and len(response.generated_images) > 0:
            img = response.generated_images[0]
            os.makedirs(IMAGE_OUTPUT_DIR, exist_ok=True)
            file_name = f"{filename_prefix}_{uuid.uuid4().hex[:8]}.png"
            file_path = os.path.join(IMAGE_OUTPUT_DIR, file_name)

            img.image.save(file_path)
            logger.info("Image saved to %s", file_path)
            return file_path
        else:
            logger.warning("No images generated in response")
            return None

    except Exception as e:
        logger.error("Imagen API error: %s", e)
        return None


# ---------------------------------------------------------------------------
# Content type labels
# ---------------------------------------------------------------------------

_CONTENT_TYPE_KR = {
    "card_news": "카드뉴스",
    "report": "보고서",
    "cover_promo": "표지/홍보페이지",
}


# ---------------------------------------------------------------------------
# Text generation (content creation)
# ---------------------------------------------------------------------------

def generate_text(
    content_type: str,
    topic: Optional[str] = None,
    content_input: Optional[str] = None,
) -> str:
    """Generate AI text for content creation using Gemini."""
    topic_str = topic or "(주제 미입력)"
    input_str = content_input or "(추가 내용 없음)"

    if content_type == "card_news":
        prompt = (
            f"당신은 금융회사의 마케팅 콘텐츠 전문가입니다.\n"
            f"주제: {topic_str}\n"
            f"참고 내용: {input_str}\n\n"
            f"위 주제로 카드뉴스 콘텐츠를 작성해주세요.\n"
            f"- 5~6장 분량의 카드뉴스 슬라이드 텍스트\n"
            f"- 각 슬라이드는 '슬라이드 N:' 으로 시작\n"
            f"- 첫 슬라이드: 임팩트 있는 헤드라인\n"
            f"- 중간 슬라이드: 핵심 포인트 (간결하게)\n"
            f"- 마지막 슬라이드: CTA (행동 유도)\n"
            f"- 한국어로 작성, 전문적이면서 친근한 톤"
        )
    elif content_type == "report":
        prompt = (
            f"당신은 금융 리서치 애널리스트입니다.\n"
            f"주제: {topic_str}\n"
            f"참고 내용: {input_str}\n\n"
            f"위 주제로 투자 보고서를 작성해주세요.\n"
            f"- 구조: 요약 → 시장 분석 → 주요 포인트 → 리스크 → 결론/제안\n"
            f"- 각 섹션은 '## 섹션명' 형식의 마크다운 헤딩 사용\n"
            f"- 전문적이고 객관적인 톤\n"
            f"- 구체적인 데이터/수치를 포함 (예시라도)\n"
            f"- 한국어로 작성"
        )
    else:  # cover_promo
        prompt = (
            f"당신은 금융회사의 디자인/카피라이터입니다.\n"
            f"주제: {topic_str}\n"
            f"참고 내용: {input_str}\n\n"
            f"위 주제로 표지/홍보페이지 텍스트를 작성해주세요.\n"
            f"- 메인 헤드라인 (1줄, 임팩트 있게)\n"
            f"- 서브 카피 (1~2줄)\n"
            f"- 본문 설명 (3~5줄)\n"
            f"- CTA 문구 (1줄)\n"
            f"- 한국어로 작성, 세련되고 프로페셔널한 톤"
        )

    return _call_gemini(prompt)


# ---------------------------------------------------------------------------
# Image generation (content design)
# ---------------------------------------------------------------------------

def generate_design(
    content_type: str,
    text_content: str,
    brand_settings: Optional[dict] = None,
) -> dict:
    """Generate design assets including AI-generated images."""
    primary_color = "#1E3A5F"
    font_family = "Noto Sans KR"
    company_name = "금융회사"

    if brand_settings:
        primary_color = brand_settings.get("primary_color", primary_color)
        font_family = brand_settings.get("font_family", font_family)
        company_name = brand_settings.get("company_name", company_name)

    assets: dict = {
        "type": content_type,
        "primary_color": primary_color,
        "font_family": font_family,
        "status": "generating",
        "files": [],
    }

    # Extract a short topic from the text for image prompts
    topic_line = text_content.split("\n")[0][:100] if text_content else "금융 서비스"

    if content_type == "card_news":
        # Generate cover image for card news
        img_prompt = (
            f"Professional financial card news cover design. "
            f"Topic: {topic_line}. "
            f"Clean modern layout, corporate style, navy blue ({primary_color}) theme. "
            f"Korean financial company marketing material. Minimalist, elegant."
        )
        cover_path = _generate_image(img_prompt, "cardnews_cover")

        assets["files"] = []
        if cover_path:
            assets["files"].append({"page": 1, "path": cover_path})
        assets["preview_path"] = cover_path or "generated/card_news/preview.png"

    elif content_type == "report":
        # Generate report cover
        img_prompt = (
            f"Professional investment report cover page design. "
            f"Topic: {topic_line}. "
            f"Elegant corporate style, navy blue ({primary_color}) header. "
            f"Clean data visualization aesthetic, modern financial report."
        )
        cover_path = _generate_image(img_prompt, "report_cover")

        assets["files"] = []
        if cover_path:
            assets["files"].append({"page": 1, "path": cover_path})
        assets["pdf_path"] = cover_path
        assets["preview_path"] = cover_path or "generated/report/cover.png"

    elif content_type == "cover_promo":
        # Generate promotional cover
        img_prompt = (
            f"Professional financial promotional banner design. "
            f"Topic: {topic_line}. "
            f"Bold headline area, corporate navy blue ({primary_color}) and gold accent. "
            f"Modern premium look, suitable for {company_name}."
        )
        cover_path = _generate_image(img_prompt, "promo_cover")

        assets["files"] = []
        if cover_path:
            assets["files"].append({"variant": "16:9", "path": cover_path})
        assets["preview_path"] = cover_path or "generated/cover_promo/cover.png"

    assets["status"] = "completed"
    return assets


# ---------------------------------------------------------------------------
# Portfolio AI analysis
# ---------------------------------------------------------------------------

def analyze_portfolio(raw_data: dict) -> dict:
    """Analyze portfolio data and generate rebalancing suggestions."""
    prompt = (
        "당신은 IRP/연금 포트폴리오 전문 자산관리사입니다.\n\n"
        f"포트폴리오 데이터:\n{raw_data}\n\n"
        "위 포트폴리오를 분석하고 다음 항목을 작성해주세요:\n"
        "1. 전체 포트폴리오 요약 (2~3줄)\n"
        "2. 위험도 평가 (낮음/중간/높음)\n"
        "3. 강점 (2~3개)\n"
        "4. 약점 (2~3개)\n"
        "5. 리밸런싱 제안 (3~5개, 각각 구체적 비중 변경 포함)\n"
        "한국어로 작성해주세요."
    )
    text = _call_gemini(prompt)
    return {"ai_analysis_text": text, "source": "gemini"}


# ---------------------------------------------------------------------------
# Stock theme analysis
# ---------------------------------------------------------------------------

def analyze_stock_themes(theme_names: list[str]) -> dict[str, dict]:
    """Analyze stock themes and return AI scores + summaries per theme."""
    themes_str = ", ".join(theme_names)
    prompt = (
        "당신은 주식/ETF 테마 분석 전문가입니다.\n\n"
        f"분석할 테마: {themes_str}\n\n"
        "각 테마에 대해 다음을 분석해주세요:\n"
        "1. AI 투자 매력도 점수 (0~100)\n"
        "2. 최근 뉴스/시장 동향 요약 (2~3줄)\n"
        "3. 관련 대표 종목 2~3개\n\n"
        "각 테마별로 구분하여 작성해주세요. 한국어로 답변."
    )
    text = _call_gemini(prompt)
    return {"analysis_text": text, "source": "gemini"}


# ---------------------------------------------------------------------------
# Stock individual analysis
# ---------------------------------------------------------------------------

def analyze_stock(stock_name: str, stock_code: str, theme: str) -> str:
    """Generate AI analysis report for an individual stock."""
    prompt = (
        "당신은 증권 리서치 애널리스트입니다.\n\n"
        f"종목: {stock_name} ({stock_code})\n"
        f"테마: {theme}\n\n"
        "이 종목에 대한 간략한 투자 분석 리포트를 작성해주세요:\n"
        "- 기업 개요 (1~2줄)\n"
        "- 투자 포인트 (3개)\n"
        "- 리스크 요인 (2개)\n"
        "- 투자 의견 (매수/중립/매도 + 근거 1줄)\n"
        "한국어로 작성, 전문적인 톤."
    )
    return _call_gemini(prompt)
