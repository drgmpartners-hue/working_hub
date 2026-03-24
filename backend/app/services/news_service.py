"""News search service — Naver News API with keyword-based caching."""
import logging
import hashlib
import html
import re
from datetime import datetime, timedelta

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

# In-memory cache: { keyword_hash: { "articles": [...], "fetched_at": datetime } }
_news_cache: dict[str, dict] = {}
CACHE_TTL = timedelta(hours=48)

# 상품명/지역 → 검색 키워드 매핑
KEYWORD_MAP = {
    "미국": "미국증시",
    "반도체": "반도체주",
    "빅테크": "미국 빅테크",
    "AI": "AI주식",
    "인도": "인도증시",
    "베트남": "베트남증시",
    "중국": "중국증시",
    "채권": "채권시장",
    "국채": "미국국채 금리",
    "로봇": "로봇주",
    "우주항공": "우주항공 방산",
    "방산": "방산주",
    "배당": "배당주",
    "글로벌": "글로벌증시",
    "국내": "코스피",
    "S&P": "S&P500",
    "나스닥": "나스닥",
    "성장": "성장주",
    "가치": "가치주",
    "금리": "금리 전망",
}


def _strip_html(text: str) -> str:
    """HTML 태그 제거 및 엔티티 디코딩."""
    clean = re.sub(r"<[^>]+>", "", text)
    return html.unescape(clean).strip()


def _pick_best_keyword(product_name: str, region: str = "") -> str:
    """종목 1개에서 가장 핵심적인 키워드 1개를 추출합니다."""
    combined = product_name + " " + (region or "")
    combined_upper = combined.upper()

    # 우선순위: 구체적 키워드 > 일반 키워드
    priority_order = [
        "반도체", "빅테크", "AI", "로봇", "우주항공", "방산", "배당",
        "국채", "채권", "금리", "나스닥", "S&P",
        "인도", "베트남", "중국", "미국", "글로벌", "국내",
    ]
    for key in priority_order:
        if key.upper() in combined_upper:
            return KEYWORD_MAP.get(key, key)

    # 매칭 안 되면 지역 기반
    if region and region != "기타":
        for key, term in KEYWORD_MAP.items():
            if key in region:
                return term

    return "증시 전망"


def extract_keywords_per_product(
    product_names: list[str], regions: list[str]
) -> list[str]:
    """종목별 1개 핵심 키워드를 추출합니다. 중복 키워드는 제거."""
    seen = set()
    keywords = []
    for i, name in enumerate(product_names):
        region = regions[i] if i < len(regions) else ""
        kw = _pick_best_keyword(name, region)
        if kw not in seen:
            seen.add(kw)
            keywords.append(kw)
    return keywords


async def search_news(keyword: str, count: int = 3) -> list[dict]:
    """네이버 뉴스 검색 API로 키워드 검색. 캐시 있으면 캐시 반환."""
    cache_key = hashlib.md5(keyword.encode()).hexdigest()

    # 캐시 확인
    cached = _news_cache.get(cache_key)
    if cached and (datetime.utcnow() - cached["fetched_at"]) < CACHE_TTL:
        logger.info("News cache hit: %s", keyword)
        return cached["articles"][:count]

    # 네이버 뉴스 검색 API
    if not settings.NAVER_CLIENT_ID or not settings.NAVER_CLIENT_SECRET:
        logger.warning("Naver API credentials not configured")
        return []

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.get(
                "https://openapi.naver.com/v1/search/news.json",
                params={"query": keyword, "display": count, "sort": "date"},
                headers={
                    "X-Naver-Client-Id": settings.NAVER_CLIENT_ID,
                    "X-Naver-Client-Secret": settings.NAVER_CLIENT_SECRET,
                },
            )

        articles = []
        if res.status_code == 200:
            data = res.json()
            for item in data.get("items", [])[:count]:
                title = _strip_html(item.get("title", ""))
                desc = _strip_html(item.get("description", ""))[:200]
                pub_date = item.get("pubDate", "")
                if title:
                    articles.append({
                        "title": title,
                        "description": desc,
                        "date": pub_date,
                    })
        else:
            logger.warning("Naver News API %d: %s", res.status_code, res.text[:200])

        # 캐시 저장
        _news_cache[cache_key] = {
            "articles": articles,
            "fetched_at": datetime.utcnow(),
        }

        logger.info("News fetched for '%s': %d articles", keyword, len(articles))
        return articles[:count]

    except Exception as e:
        logger.error("News search error for '%s': %s", keyword, e)
        return []


async def get_market_context(product_names: list[str], regions: list[str]) -> str:
    """종목별 핵심 키워드 1개씩 추출 → 키워드당 5건 뉴스 검색 → 시장 컨텍스트 반환."""
    keywords = extract_keywords_per_product(product_names, regions)
    max_articles = len(product_names) * 5

    all_articles = []
    for kw in keywords:
        articles = await search_news(kw, count=5)
        for a in articles:
            all_articles.append(f"[{kw}] {a['title']}")

    if not all_articles:
        return "(최신 시장 뉴스를 가져오지 못했습니다.)"

    # 중복 제거 후 최대 (종목수 × 5)건
    unique = list(dict.fromkeys(all_articles))
    return "\n".join(unique[:max_articles])
