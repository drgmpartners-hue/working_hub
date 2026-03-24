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
) -> str:
    """포트폴리오 분석 코멘트용 프롬프트를 조합합니다."""
    analysis_block = "\n\n".join([
        f"[{kw} 시황]\n{text}" for kw, text in analyses.items()
    ])

    return (
        "당신은 고객의 자산을 관리하는 전문 자산관리사입니다.\n"
        "고객에게 보낼 포트폴리오 분석 보고서를 작성해주세요.\n\n"
        f"고객명: {client_name}\n"
        f"계좌 유형: {account_type}\n"
        f"기준일: {snapshot_date}\n"
        f"총 평가금액: {total_evaluation:,.0f}원\n"
        f"총 수익률: {total_return_rate:.2f}%\n\n"
        "보유 종목:\n"
        + "\n".join(holdings_lines)
        + "\n\n"
        "최근 시장 상황:\n"
        + analysis_block
        + "\n\n"
        "위 정보를 바탕으로 고객에게 보낼 분석 코멘트를 작성해주세요.\n\n"
        "반드시 포함할 내용:\n"
        "1. 고객님의 전체 투자 현황을 한눈에 알 수 있게 요약 (2줄)\n"
        "2. 돈을 번 종목은 왜 올랐는지, 손해를 본 종목은 왜 떨어졌는지를 최근 시장 뉴스와 연결해서 쉽게 설명 (종목별 1-2줄씩)\n"
        "3. 현재 포트폴리오에서 좋은 점과 조심해야 할 점 (2줄)\n"
        "4. 앞으로의 시장 전망과 참고할 사항 (2줄)\n\n"
        "작성 규칙:\n"
        "- 고등학생도 이해할 수 있는 쉬운 말로 작성\n"
        "- 전문 용어가 나오면 괄호 안에 쉬운 설명 추가 (예: 변동성(가격이 오르내리는 폭))\n"
        "- '~입니다', '~합니다' 체로 정중하게 작성\n"
        "- 단정짓지 말고 '~할 수 있습니다', '~가능성이 있습니다' 등 신중하게 표현\n"
        "- 총 10-15줄 분량"
    )


def build_change_comment_prompt(
    client_name: str,
    account_type: str,
    holdings_before: list[dict],  # [{"name": "...", "weight": 10.5, "return_rate": -5.2}, ...]
    holdings_after: list[dict],   # [{"name": "...", "weight": 15.0}, ...]
    analyses: dict[str, str],
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

    return (
        "당신은 고객의 자산을 관리하는 전문 자산관리사입니다.\n"
        "고객에게 '왜 포트폴리오를 이렇게 바꾸는지' 납득시키는 안내문을 작성해주세요.\n\n"
        f"고객명: {client_name}\n"
        f"계좌 유형: {account_type}\n\n"
        "포트폴리오 변경 내역:\n"
        + change_block
        + "최근 시장 상황:\n"
        + analysis_block
        + "\n\n"
        "위 정보를 바탕으로 변경 안내 코멘트를 작성해주세요.\n\n"
        "★ 비중 배분: 현재 포트폴리오 분석은 20%, 변경 원인·근거·전망은 80%로 작성하세요.\n\n"
        "반드시 포함할 내용:\n"
        "1. [간단 현황] 현재 포트폴리오 상태를 1-2줄로 간략히 요약\n"
        "2. [왜 줄였나] 매도하거나 비중을 줄인 종목은:\n"
        "   - 최근 시장에서 무슨 일이 있었는지\n"
        "   - 그래서 왜 지금 줄이는 것이 합리적인지\n"
        "   - 앞으로 이 분야가 어떻게 될 것으로 보이는지\n"
        "3. [왜 늘렸나] 비중을 늘리거나 새로 추가한 종목은:\n"
        "   - 이 분야의 최근 흐름이 어떤지\n"
        "   - 왜 지금 투자 비중을 높이는 것이 좋은지\n"
        "   - 앞으로 어떤 성장이 기대되는지\n"
        "4. [기대 효과] 이번 변경으로 포트폴리오가 어떻게 좋아지는지 (1-2줄)\n"
        "5. [주의사항] 그래도 조심해야 할 점 (1줄)\n\n"
        "작성 규칙:\n"
        "- 고등학생도 이해할 수 있는 쉬운 말로 작성\n"
        "- 전문 용어가 나오면 괄호 안에 쉬운 설명 추가\n"
        "- '~입니다', '~합니다' 체로 정중하게 작성\n"
        "- 단정짓지 말고 '~할 수 있습니다', '~가능성이 있습니다' 등 신중하게 표현\n"
        "- 총 15-20줄 분량"
    )


async def cleanup_expired(db: AsyncSession) -> None:
    """48시간 지난 캐시를 삭제합니다."""
    cutoff = datetime.utcnow() - CACHE_TTL
    await db.execute(
        delete(MarketAnalysisCache).where(MarketAnalysisCache.created_at < cutoff)
    )
    await db.commit()
