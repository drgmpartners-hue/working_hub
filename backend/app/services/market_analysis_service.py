"""Market analysis service — 키워드별 시황 분석 생성/캐시/조합."""
import logging
import uuid
from datetime import datetime, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete

from app.models.market_analysis_cache import MarketAnalysisCache
from app.services.news_service import search_news, _pick_best_keyword

logger = logging.getLogger(__name__)

CACHE_TTL = timedelta(hours=48)


async def _get_or_create_analysis(
    db: AsyncSession, keyword: str
) -> str:
    """키워드의 시황 분석을 가져오거나 새로 생성합니다."""
    # 1. DB 캐시 확인
    result = await db.execute(
        select(MarketAnalysisCache).where(MarketAnalysisCache.keyword == keyword)
    )
    cached = result.scalar_one_or_none()

    if cached and (datetime.utcnow() - cached.created_at) < CACHE_TTL:
        logger.info("Market analysis cache hit: %s", keyword)
        return cached.analysis

    # 2. 뉴스 검색
    articles = await search_news(keyword, count=5)
    if not articles:
        news_text = "(관련 뉴스를 찾지 못했습니다.)"
    else:
        news_text = "\n".join([
            f"- {a['title']}: {a['description']}" for a in articles
        ])

    # 3. Gemini로 시황 분석 생성
    from app.core.config import settings
    if not settings.GEMINI_API_KEY:
        return f"[{keyword}] 시황 분석을 위해 Gemini API Key가 필요합니다."

    try:
        from app.services.ai_service import _call_gemini

        prompt = (
            f"당신은 고객에게 시장 상황을 알기 쉽게 설명해주는 자산관리사입니다.\n\n"
            f"키워드: {keyword}\n\n"
            f"최신 관련 뉴스:\n{news_text}\n\n"
            f"위 뉴스를 바탕으로 '{keyword}' 관련 시장 상황을 정리해주세요.\n"
            f"다음 내용을 포함하여 5-7줄로 작성해주세요:\n"
            f"1. 지금 이 시장에서 무슨 일이 벌어지고 있는지\n"
            f"2. 왜 가격이 올랐는지 또는 떨어졌는지 (핵심 원인)\n"
            f"3. 앞으로 어떻게 될 가능성이 있는지 (전망)\n\n"
            f"고등학생도 이해할 수 있을 정도로 쉬운 말로 써주세요.\n"
            f"전문 용어가 나오면 반드시 괄호 안에 쉬운 설명을 덧붙여주세요."
        )

        analysis = _call_gemini(prompt)

        if analysis.startswith("[AI 응답 실패"):
            analysis = f"[{keyword}] 시황 분석 생성에 실패했습니다."

    except Exception as e:
        logger.error("Gemini analysis error for '%s': %s", keyword, e)
        analysis = f"[{keyword}] 시황 분석 생성 중 오류가 발생했습니다."

    # 4. DB 저장 (upsert)
    if cached:
        cached.news_summary = news_text[:2000]
        cached.analysis = analysis
        cached.created_at = datetime.utcnow()
    else:
        new_cache = MarketAnalysisCache(
            id=str(uuid.uuid4()),
            keyword=keyword,
            news_summary=news_text[:2000],
            analysis=analysis,
        )
        db.add(new_cache)

    await db.commit()
    logger.info("Market analysis created/updated: %s", keyword)
    return analysis


async def get_analyses_for_portfolio(
    db: AsyncSession,
    product_names: list[str],
    regions: list[str],
) -> dict[str, str]:
    """포트폴리오 종목별 키워드 시황 분석을 가져옵니다.

    Returns:
        { "미국 빅테크": "분석 내용...", "인도증시": "분석 내용...", ... }
    """
    seen_keywords: set[str] = set()
    analyses: dict[str, str] = {}

    for i, name in enumerate(product_names):
        region = regions[i] if i < len(regions) else ""
        keyword = _pick_best_keyword(name, region)
        if keyword in seen_keywords:
            continue
        seen_keywords.add(keyword)
        analyses[keyword] = await _get_or_create_analysis(db, keyword)

    return analyses


def build_analysis_comment_prompt(
    client_name: str,
    account_type: str,
    snapshot_date: str,
    total_evaluation: float,
    total_return_rate: float,
    holdings_lines: list[str],
    analyses: dict[str, str],
    changes_summary: str = "",
) -> str:
    """포트폴리오 분석 코멘트용 프롬프트를 조합합니다."""
    analysis_block = "\n\n".join([
        f"[{kw} 시황]\n{text}" for kw, text in analyses.items()
    ])

    changes_section = ""
    if changes_summary:
        changes_section = (
            "\n\n수정 포트폴리오 변경 내역:\n"
            + changes_summary
            + "\n"
        )

    return (
        "당신은 고객의 자산을 관리하는 자산관리사입니다.\n"
        "고객에게 보낼 포트폴리오 분석 코멘트를 작성해주세요.\n\n"
        f"고객명: {client_name}\n"
        f"계좌 유형: {account_type}\n"
        f"기준일: {snapshot_date}\n"
        f"총 평가금액: {total_evaluation:,.0f}원\n"
        f"총 수익률: {total_return_rate:.2f}%\n\n"
        "보유 종목:\n"
        + "\n".join(holdings_lines)
        + changes_section
        + "\n\n최근 시장 상황:\n"
        + analysis_block
        + "\n\n"
        "위 정보를 바탕으로 분석 코멘트를 작성해주세요.\n\n"
        "★★★ 반드시 아래 3개 섹션만 작성하세요. 투자 현황 요약, 리밸런싱 근거 등 다른 섹션은 절대 추가 금지. ★★★\n\n"
        "아래 HTML 템플릿을 그대로 따라서 작성하세요:\n\n"
        "<div style=\"background:#1E3A5F;color:#fff;padding:6px 14px;font-size:0.8125rem;font-weight:700;"
        "border-radius:4px;margin-bottom:8px\">포트폴리오 진단</div>\n"
        "<div style=\"font-size:0.8125rem;line-height:1.8;color:#374151;margin-bottom:16px\">\n"
        "2줄 이내. 포트폴리오의 전반적 상태, 강점, 주의할 점.\n"
        "</div>\n\n"
        "<div style=\"background:#1E3A5F;color:#fff;padding:6px 14px;font-size:0.8125rem;font-weight:700;"
        "border-radius:4px;margin-bottom:8px\">종목별 분석</div>\n"
        "<div style=\"font-size:0.8125rem;line-height:1.8;color:#374151;margin-bottom:16px\">\n"
        "3줄 이내. 주요 수익/손실 종목의 등락 이유를 시장 상황과 연결하여 간결하게 설명.\n"
        "</div>\n\n"
        "<div style=\"background:#1E3A5F;color:#fff;padding:6px 14px;font-size:0.8125rem;font-weight:700;"
        "border-radius:4px;margin-bottom:8px\">시장 전망</div>\n"
        "<div style=\"font-size:0.8125rem;line-height:1.8;color:#374151\">\n"
        "2줄 이내. 보유 종목 관련 시장 흐름과 앞으로의 전망.\n"
        "</div>\n\n"
        "★ 핵심 수치/종목명은 <span style=\"color:#1E3A5F;font-weight:600\"> 태그로 강조\n"
        "★ 인사말, 맺음말, 자기소개 등 사족은 절대 넣지 마세요.\n"
        "★ 각 섹션 내용은 지정된 줄 수를 반드시 지키세요. 초과 금지.\n\n"
        "작성 규칙:\n"
        "- 중학생도 이해할 수 있는 쉬운 말\n"
        "- 전문 용어는 괄호로 설명 추가\n"
        "- '~합니다' 체, 신중한 표현"
    )


def build_change_comment_prompt(
    client_name: str,
    account_type: str,
    holdings_before: list[dict],  # [{"name": "...", "weight": 10.5, "return_rate": -5.2}, ...]
    holdings_after: list[dict],   # [{"name": "...", "weight": 15.0}, ...]
    analyses: dict[str, str],
    manager_note: str = "",
) -> str:
    """포트폴리오 변경 코멘트용 프롬프트를 조합합니다."""
    # 변경 내역 분류
    sold_lines = []
    reduced_lines = []
    increased_lines = []
    new_lines = []

    before_map = {h["name"]: h for h in holdings_before}
    after_map = {h["name"]: h for h in holdings_after}

    for name, after in after_map.items():
        before = before_map.get(name)
        after_w = after.get("weight", 0)
        if not before:
            new_lines.append(f"- [신규 편입] {name}: 비중 {after_w:.1f}%")
        else:
            before_w = before.get("weight", 0)
            diff = after_w - before_w
            if after_w == 0:
                sold_lines.append(f"- [전액 매도] {name}: {before_w:.1f}% → 0%")
            elif diff > 0.5:
                increased_lines.append(f"- [비중 확대] {name}: {before_w:.1f}% → {after_w:.1f}% (+{diff:.1f}%p)")
            elif diff < -0.5:
                reduced_lines.append(f"- [비중 축소] {name}: {before_w:.1f}% → {after_w:.1f}% ({diff:.1f}%p)")

    for name, before in before_map.items():
        if name not in after_map:
            sold_lines.append(f"- [전액 매도] {name}: {before.get('weight', 0):.1f}% → 0%")

    change_block = ""
    if sold_lines:
        change_block += "매도 종목:\n" + "\n".join(sold_lines) + "\n\n"
    if reduced_lines:
        change_block += "비중 축소 종목:\n" + "\n".join(reduced_lines) + "\n\n"
    if increased_lines:
        change_block += "비중 확대 종목:\n" + "\n".join(increased_lines) + "\n\n"
    if new_lines:
        change_block += "신규 편입 종목:\n" + "\n".join(new_lines) + "\n\n"

    analysis_block = "\n\n".join([
        f"[{kw} 시황]\n{text}" for kw, text in analyses.items()
    ])

    manager_section = ""
    if manager_note.strip():
        manager_section = (
            "\n\n★ 담당 자산관리사의 조절 근거 및 의견:\n"
            f"{manager_note}\n"
            "\n위 담당자 의견을 반드시 반영하되, AI가 전문적이고 논리적으로 재편집하여 "
            "고객이 납득할 수 있는 수준의 글로 작성해주세요.\n"
        )

    return (
        "당신은 고객의 자산을 관리하는 전문 자산관리사입니다.\n"
        "고객에게 '왜 포트폴리오를 이렇게 바꾸는지' 납득시키는 안내문을 작성해주세요.\n\n"
        f"고객명: {client_name}\n"
        f"계좌 유형: {account_type}\n\n"
        "포트폴리오 변경 내역:\n"
        + change_block
        + "최근 시장 상황:\n"
        + analysis_block
        + manager_section
        + "\n\n"
        "위 정보를 바탕으로 변경 안내 리포트를 작성해주세요.\n\n"
        "★ 비중 배분: 현재 분석 20%, 변경 원인·근거·전망 80%로 작성.\n\n"
        "아래 HTML 템플릿을 정확히 따라서 5개 섹션을 작성하세요:\n\n"
        "--- 템플릿 시작 ---\n\n"
        "<div style=\"background:#1E3A5F;color:#fff;padding:8px 16px;font-size:0.8125rem;font-weight:700;"
        "border-radius:4px;margin-bottom:10px\">현재 현황</div>\n"
        "<div style=\"font-size:0.8125rem;line-height:1.8;color:#374151;margin-bottom:20px\">\n"
        "포트폴리오 상태를 2줄 이내로 간결하게 요약.\n"
        "</div>\n\n"
        "<div style=\"background:#1E3A5F;color:#fff;padding:8px 16px;font-size:0.8125rem;font-weight:700;"
        "border-radius:4px;margin-bottom:10px\">비중 축소/매도 분석</div>\n"
        "<div style=\"font-size:0.8125rem;line-height:1.8;color:#374151;margin-bottom:20px\">\n"
        "매도/축소한 종목별로 각 2줄 이내. 왜 줄였는지 시장 상황과 연결하여 설명. 종목마다 줄바꿈(<br>)으로 구분.\n"
        "</div>\n\n"
        "<div style=\"background:#1E3A5F;color:#fff;padding:8px 16px;font-size:0.8125rem;font-weight:700;"
        "border-radius:4px;margin-bottom:10px\">비중 확대/신규 편입 분석</div>\n"
        "<div style=\"font-size:0.8125rem;line-height:1.8;color:#374151;margin-bottom:20px\">\n"
        "확대/신규 종목별로 각 2줄 이내. 왜 늘렸는지 시장 흐름과 성장 기대를 설명. 종목마다 줄바꿈(<br>)으로 구분.\n"
        "</div>\n\n"
        "<div style=\"background:#1E3A5F;color:#fff;padding:8px 16px;font-size:0.8125rem;font-weight:700;"
        "border-radius:4px;margin-bottom:10px\">기대 효과</div>\n"
        "<div style=\"font-size:0.8125rem;line-height:1.8;color:#374151;margin-bottom:20px\">\n"
        "이번 변경으로 포트폴리오가 어떻게 개선되는지 2줄 이내.\n"
        "</div>\n\n"
        "<div style=\"background:#1E3A5F;color:#fff;padding:8px 16px;font-size:0.8125rem;font-weight:700;"
        "border-radius:4px;margin-bottom:10px\">유의 사항</div>\n"
        "<div style=\"font-size:0.8125rem;line-height:1.8;color:#374151\">\n"
        "이번 변경의 구체적 위험요인, 시장 변동 대응 방향 등 실질적 내용 2줄 이내.\n"
        "</div>\n\n"
        "--- 템플릿 끝 ---\n\n"
        "★ 종목명: <span style=\"font-weight:700;color:#1E3A5F\">종목명</span>\n"
        "★ 하락 수치: <span style=\"color:#DC2626;font-weight:600\">-11.72%</span>\n"
        "★ 상승 수치: <span style=\"color:#059669;font-weight:600\">+34.68%</span>\n"
        "★ 각 섹션 상세 내용은 반드시 2줄 이내. 초과 금지.\n"
        "★ 인사말, 맺음말, 사족 절대 금지.\n\n"
        "작성 규칙:\n"
        "- 중학생도 이해할 수 있는 쉬운 말\n"
        "- 전문 용어는 괄호로 설명 추가\n"
        "- '~합니다' 체, 신중한 표현"
    )


async def cleanup_expired(db: AsyncSession) -> None:
    """48시간 지난 캐시를 삭제합니다."""
    cutoff = datetime.utcnow() - CACHE_TTL
    await db.execute(
        delete(MarketAnalysisCache).where(MarketAnalysisCache.created_at < cutoff)
    )
    await db.commit()
