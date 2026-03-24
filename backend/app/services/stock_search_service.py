"""Stock/ETF search service using Naver Finance API (free, no auth required)."""
import json
import logging
from typing import Optional
from datetime import datetime, timedelta

import httpx

logger = logging.getLogger(__name__)

# Cache: refresh every 30 minutes
_cache: dict = {"items": [], "updated_at": None}
CACHE_TTL = timedelta(minutes=30)


async def _fetch_etf_list() -> list[dict]:
    """Fetch full ETF list from Naver Finance API."""
    now = datetime.utcnow()
    if _cache["items"] and _cache["updated_at"] and (now - _cache["updated_at"]) < CACHE_TTL:
        return _cache["items"]

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            res = await client.get(
                "https://finance.naver.com/api/sise/etfItemList.nhn",
                params={"etfType": "0", "targetColumn": "market_sum", "sortOrder": "desc"},
                headers={"User-Agent": "Mozilla/5.0"},
            )
        if res.status_code != 200:
            logger.warning("Naver ETF API returned %d", res.status_code)
            return _cache["items"]  # return stale cache

        text = res.content.decode("euc-kr", errors="replace")
        data = json.loads(text)
        items = data.get("result", {}).get("etfItemList", [])

        # Normalize to our format
        result = []
        for it in items:
            result.append({
                "code": it.get("itemcode", ""),
                "name": it.get("itemname", ""),
                "nav": it.get("nav"),
                "price": it.get("nowVal"),
                "change_rate": it.get("changeRate"),
                "market_sum": it.get("marketSum"),
                "type": "ETF",
            })

        _cache["items"] = result
        _cache["updated_at"] = now
        logger.info("Loaded %d ETF items from Naver Finance", len(result))
        return result

    except Exception as e:
        logger.error("Failed to fetch ETF list: %s", e)
        return _cache["items"]


async def search_stocks(query: str, limit: int = 20) -> list[dict]:
    """Search ETF/stocks by name (fuzzy match). Returns matching items."""
    items = await _fetch_etf_list()
    if not query or not query.strip():
        return items[:limit]

    q = query.strip().replace(" ", "").lower()
    keywords = query.strip().lower().split()

    scored: list[tuple[int, dict]] = []
    for item in items:
        name_lower = item["name"].replace(" ", "").lower()
        name_spaced = item["name"].lower()
        code = item["code"].lower()

        # Exact code match
        if q == code:
            scored.append((1000, item))
            continue

        # Exact name match
        if q == name_lower:
            scored.append((900, item))
            continue

        # All keywords match
        if all(kw in name_spaced or kw in name_lower for kw in keywords):
            scored.append((800, item))
            continue

        # Partial match (query contained in name)
        if q in name_lower:
            scored.append((700, item))
            continue

        # Any keyword match - score by how many match
        match_count = sum(1 for kw in keywords if kw in name_spaced or kw in name_lower)
        if match_count > 0:
            scored.append((500 + match_count * 50, item))

    scored.sort(key=lambda x: -x[0])
    return [item for _, item in scored[:limit]]


async def get_stock_price(code: str) -> Optional[dict]:
    """Get current price/NAV for a specific stock code."""
    items = await _fetch_etf_list()
    for item in items:
        if item["code"] == code:
            return item
    return None
