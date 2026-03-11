"""Mock AI service for content generation.

All functions in this module are placeholder implementations that return
realistic-looking mock data. Replace with real AI API calls in production.
"""
from typing import Optional


# ---------------------------------------------------------------------------
# Text generation
# ---------------------------------------------------------------------------

_TEXT_TEMPLATES = {
    "card_news": (
        "[AI 생성 카드뉴스 텍스트]\n\n"
        "주제: {topic}\n\n"
        "핵심 메시지:\n"
        "1. 첫 번째 핵심 포인트\n"
        "2. 두 번째 핵심 포인트\n"
        "3. 세 번째 핵심 포인트\n\n"
        "설명:\n{content_input}\n\n"
        "※ 이 텍스트는 AI가 자동 생성한 초안입니다."
    ),
    "report": (
        "[AI 생성 리포트]\n\n"
        "제목: {topic}\n\n"
        "요약:\n"
        "본 리포트는 주요 투자 동향과 시장 분석 결과를 정리한 자료입니다.\n\n"
        "주요 내용:\n{content_input}\n\n"
        "결론:\n"
        "위의 분석을 바탕으로 포트폴리오 재조정을 권고합니다.\n\n"
        "※ 이 리포트는 AI가 자동 생성한 초안입니다."
    ),
    "cover_promo": (
        "[AI 생성 커버/프로모 텍스트]\n\n"
        "헤드라인: {topic}\n\n"
        "서브 카피:\n"
        "지금 바로 확인하세요!\n\n"
        "본문:\n{content_input}\n\n"
        "CTA: 자세히 보기\n\n"
        "※ 이 텍스트는 AI가 자동 생성한 초안입니다."
    ),
}


def generate_text(
    content_type: str,
    topic: Optional[str] = None,
    content_input: Optional[str] = None,
) -> str:
    """Generate mock AI text for the given content type.

    Args:
        content_type: One of card_news / report / cover_promo.
        topic: Optional topic string provided by the user.
        content_input: Optional raw input text provided by the user.

    Returns:
        A mock-generated text string.
    """
    template = _TEXT_TEMPLATES.get(
        content_type,
        "[AI 생성 텍스트]\n\n주제: {topic}\n\n내용: {content_input}",
    )
    return template.format(
        topic=topic or "(주제 미입력)",
        content_input=content_input or "(입력 내용 없음)",
    )


# ---------------------------------------------------------------------------
# Design / asset generation
# ---------------------------------------------------------------------------

def generate_design(
    content_type: str,
    text_content: str,
    brand_settings: Optional[dict] = None,
) -> dict:
    """Generate mock design assets for the given content type.

    In production this would call an image generation API (e.g. DALL-E, Stable
    Diffusion) or a design automation service.

    Args:
        content_type: One of card_news / report / cover_promo.
        text_content: The (possibly AI-generated) text to embed in the design.
        brand_settings: Optional brand config dict (colors, fonts, logo).

    Returns:
        A dict describing the generated asset paths and metadata.
    """
    primary_color = "#1E3A5F"
    font_family = "Noto Sans KR"

    if brand_settings:
        primary_color = brand_settings.get("primary_color", primary_color)
        font_family = brand_settings.get("font_family", font_family)

    base_path = f"generated/{content_type}"

    assets: dict = {
        "type": content_type,
        "primary_color": primary_color,
        "font_family": font_family,
        "status": "mock",
        "files": [],
    }

    if content_type == "card_news":
        assets["files"] = [
            {"page": i + 1, "path": f"{base_path}/slide_{i + 1}.png"}
            for i in range(5)
        ]
        assets["preview_path"] = f"{base_path}/preview.png"

    elif content_type == "report":
        assets["files"] = [
            {"page": i + 1, "path": f"{base_path}/page_{i + 1}.png"}
            for i in range(10)
        ]
        assets["pdf_path"] = f"{base_path}/report.pdf"
        assets["preview_path"] = f"{base_path}/cover.png"

    elif content_type == "cover_promo":
        assets["files"] = [
            {"variant": "16x9", "path": f"{base_path}/cover_16x9.png"},
            {"variant": "1x1", "path": f"{base_path}/cover_1x1.png"},
            {"variant": "9x16", "path": f"{base_path}/cover_9x16.png"},
        ]
        assets["preview_path"] = f"{base_path}/cover_16x9.png"

    else:
        assets["files"] = [{"path": f"{base_path}/output.png"}]

    return assets
