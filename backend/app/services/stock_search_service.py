"""Stock/ETF/주식 search service.

- 국내 ETF: Naver Finance API (무료, 인증 불필요)
- 국내 주식: Naver Finance API (KOSPI + KOSDAQ)
- 해외 주식: yfinance (Yahoo Finance, 무료, 인증 불필요)
"""
import json
import logging
import asyncio
from typing import Optional
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor

import httpx

logger = logging.getLogger(__name__)

# Thread pool for yfinance (blocking I/O)
_yf_executor = ThreadPoolExecutor(max_workers=3)

# ──────────────────────────────────────────────
# Caches
# ──────────────────────────────────────────────
_etf_cache: dict = {"items": [], "updated_at": None}
_kr_stock_cache: dict = {"items": [], "updated_at": None}
CACHE_TTL = timedelta(minutes=30)


# ──────────────────────────────────────────────
# 1) 국내 ETF (Naver Finance)
# ──────────────────────────────────────────────
async def _fetch_etf_list() -> list[dict]:
    now = datetime.utcnow()
    if _etf_cache["items"] and _etf_cache["updated_at"] and (now - _etf_cache["updated_at"]) < CACHE_TTL:
        return _etf_cache["items"]

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            res = await client.get(
                "https://finance.naver.com/api/sise/etfItemList.nhn",
                params={"etfType": "0", "targetColumn": "market_sum", "sortOrder": "desc"},
                headers={"User-Agent": "Mozilla/5.0"},
            )
        if res.status_code != 200:
            return _etf_cache["items"]

        text = res.content.decode("euc-kr", errors="replace")
        data = json.loads(text)
        items = data.get("result", {}).get("etfItemList", [])

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

        _etf_cache["items"] = result
        _etf_cache["updated_at"] = now
        logger.info("Loaded %d ETF items", len(result))
        return result
    except Exception as e:
        logger.error("Failed to fetch ETF list: %s", e)
        return _etf_cache["items"]


# ──────────────────────────────────────────────
# 2) 국내 주식 (Naver Finance - KOSPI + KOSDAQ)
# ──────────────────────────────────────────────
async def _fetch_kr_stock_list() -> list[dict]:
    now = datetime.utcnow()
    if _kr_stock_cache["items"] and _kr_stock_cache["updated_at"] and (now - _kr_stock_cache["updated_at"]) < CACHE_TTL:
        return _kr_stock_cache["items"]

    result = []
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            for market in ["stockMkt", "kosdaqMkt"]:
                market_label = "KOSPI" if market == "stockMkt" else "KOSDAQ"
                page = 1
                while page <= 40:  # 최대 40페이지 (~4000종목)
                    res = await client.get(
                        "https://finance.naver.com/sise/sise_market_sum.naver",
                        params={"sosok": "0" if market == "stockMkt" else "1", "page": str(page)},
                        headers={"User-Agent": "Mozilla/5.0"},
                    )
                    if res.status_code != 200:
                        break
                    text = res.content.decode("euc-kr", errors="replace")
                    # 간단 HTML 파싱: /item/main.naver?code=XXXXXX 패턴 추출
                    import re
                    rows = re.findall(
                        r'<a href="/item/main\.naver\?code=(\d{6})"[^>]*>\s*([^<]+?)\s*</a>',
                        text,
                    )
                    if not rows:
                        break
                    # 현재가 추출: 각 행의 td에서 숫자 추출
                    price_pattern = re.findall(
                        r'<a href="/item/main\.naver\?code=(\d{6})"[^>]*>[^<]+</a>\s*</td>\s*'
                        r'(?:<td[^>]*>\s*</td>\s*)?'  # 빈 td 건너뛸 수 있음
                        r'<td[^>]*class="number"[^>]*>\s*([\d,]+)\s*</td>',
                        text,
                    )
                    price_map = {code: int(p.replace(",", "")) for code, p in price_pattern}
                    for code, name in rows:
                        if not name.strip():
                            continue
                        result.append({
                            "code": code,
                            "name": name.strip(),
                            "price": price_map.get(code),
                            "nav": None,
                            "change_rate": None,
                            "market_sum": None,
                            "type": "국내주식",
                            "market": market_label,
                        })
                    page += 1

        # 중복 제거
        seen = set()
        deduped = []
        for item in result:
            if item["code"] not in seen:
                seen.add(item["code"])
                deduped.append(item)

        _kr_stock_cache["items"] = deduped
        _kr_stock_cache["updated_at"] = now
        logger.info("Loaded %d KR stock items", len(deduped))
        return deduped
    except Exception as e:
        logger.error("Failed to fetch KR stock list: %s", e)
        return _kr_stock_cache["items"]


# ──────────────────────────────────────────────
# 3) 해외 주식/ETF (yfinance - Yahoo Finance)
# ──────────────────────────────────────────────
def _yf_quote_type(quote_type: str) -> str:
    """Yahoo quoteType → 우리 상품유형."""
    qt = (quote_type or "").upper()
    if qt == "ETF":
        return "해외ETF"
    return "미국주식"


def _yf_search_sync(query: str, limit: int = 10) -> list[dict]:
    """yfinance 검색 (blocking) — ThreadPoolExecutor에서 실행."""
    try:
        import yfinance as yf
        results = []
        # 먼저 Ticker 직접 조회 시도 (정확한 심볼인 경우)
        try:
            ticker = yf.Ticker(query.upper())
            info = ticker.info
            if info and info.get("shortName"):
                qt = info.get("quoteType", "EQUITY")
                results.append({
                    "code": info.get("symbol", query.upper()),
                    "name": info.get("shortName", ""),
                    "price": info.get("currentPrice") or info.get("regularMarketPrice"),
                    "nav": info.get("navPrice") if qt == "ETF" else None,
                    "change_rate": None,
                    "market_sum": info.get("marketCap") or info.get("totalAssets"),
                    "type": _yf_quote_type(qt),
                    "exchange": info.get("exchange", ""),
                    "currency": info.get("currency", "USD"),
                })
        except Exception:
            pass

        # yfinance search API
        try:
            search_result = yf.Search(query, max_results=limit)
            for quote in (search_result.quotes or []):
                symbol = quote.get("symbol", "")
                if any(r["code"] == symbol for r in results):
                    continue
                # 한국 거래소 제외 (국내는 네이버에서 처리)
                exchange = quote.get("exchange", "")
                if exchange in ("KSC", "KOE"):
                    continue
                ex_display = quote.get("exchDisp", exchange)
                qt = quote.get("quoteType", "EQUITY")
                results.append({
                    "code": symbol,
                    "name": quote.get("shortname") or quote.get("longname") or symbol,
                    "price": None,
                    "nav": None,
                    "change_rate": None,
                    "market_sum": None,
                    "type": _yf_quote_type(qt),
                    "exchange": ex_display,
                    "currency": quote.get("currency", ""),
                })
        except Exception as e:
            logger.debug("yfinance Search failed: %s", e)

        return results[:limit]
    except Exception as e:
        logger.error("yfinance search error: %s", e)
        return []


def _yf_price_sync(code: str) -> Optional[dict]:
    """yfinance 가격 조회 (blocking)."""
    try:
        import yfinance as yf
        ticker = yf.Ticker(code)
        info = ticker.info
        if not info or not info.get("shortName"):
            return None
        qt = info.get("quoteType", "EQUITY")
        return {
            "code": info.get("symbol", code),
            "name": info.get("shortName", ""),
            "price": info.get("currentPrice") or info.get("regularMarketPrice"),
            "nav": info.get("navPrice") if qt == "ETF" else None,
            "change_rate": None,
            "market_sum": info.get("marketCap") or info.get("totalAssets"),
            "type": _yf_quote_type(qt),
            "exchange": info.get("exchange", ""),
            "currency": info.get("currency", "USD"),
        }
    except Exception as e:
        logger.error("yfinance price error for %s: %s", code, e)
        return None


async def _search_foreign(query: str, limit: int = 10) -> list[dict]:
    """해외 주식 검색 (async wrapper)."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_yf_executor, _yf_search_sync, query, limit)


async def _get_foreign_price(code: str) -> Optional[dict]:
    """해외 주식 가격 조회 (async wrapper)."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_yf_executor, _yf_price_sync, code)


# ──────────────────────────────────────────────
# Public API
# ──────────────────────────────────────────────
def _score_items(items: list[dict], query: str) -> list[tuple[int, dict]]:
    """검색어로 아이템 목록 점수 매기기."""
    q = query.strip().replace(" ", "").lower()
    keywords = query.strip().lower().split()
    scored: list[tuple[int, dict]] = []
    for item in items:
        name_lower = item["name"].replace(" ", "").lower()
        name_spaced = item["name"].lower()
        code = item["code"].lower()
        if q == code:
            scored.append((1000, item))
        elif q == name_lower:
            scored.append((900, item))
        elif all(kw in name_spaced or kw in name_lower for kw in keywords):
            scored.append((800, item))
        elif q in name_lower:
            scored.append((700, item))
        else:
            match_count = sum(1 for kw in keywords if kw in name_spaced or kw in name_lower)
            if match_count > 0:
                scored.append((500 + match_count * 50, item))
    scored.sort(key=lambda x: -x[0])
    return scored


async def search_stocks(query: str, limit: int = 20, stock_type: str = "") -> list[dict]:
    """통합 검색. stock_type: '', 'etf', 'kr_stock', 'us_stock', 'foreign'."""
    if not query or not query.strip():
        if stock_type == "kr_stock":
            items = await _fetch_kr_stock_list()
            return items[:limit]
        items = await _fetch_etf_list()
        return items[:limit]

    if stock_type in ("us_stock", "foreign"):
        # 해외주식+해외ETF: yfinance로 검색 (quoteType으로 자동 구분)
        return await _search_foreign(query, limit)

    if stock_type == "kr_stock":
        # 국내주식: 네이버
        items = await _fetch_kr_stock_list()
        scored = _score_items(items, query)
        return [item for _, item in scored[:limit]]

    if stock_type == "etf":
        # 국내 ETF만
        items = await _fetch_etf_list()
        scored = _score_items(items, query)
        return [item for _, item in scored[:limit]]

    # 기본: ETF에서 검색 (기존 동작 유지)
    items = await _fetch_etf_list()
    scored = _score_items(items, query)
    return [item for _, item in scored[:limit]]


async def get_stock_price(code: str) -> Optional[dict]:
    """종목코드로 가격 조회. 국내 ETF → 국내주식 → 해외주식 순서로 시도."""
    # 1) 국내 ETF
    etf_items = await _fetch_etf_list()
    for item in etf_items:
        if item["code"] == code:
            return item

    # 2) 국내 주식 (6자리 숫자 코드)
    if code.isdigit() and len(code) == 6:
        kr_items = await _fetch_kr_stock_list()
        for item in kr_items:
            if item["code"] == code:
                # 실시간 가격 갱신 (네이버 개별 종목)
                try:
                    async with httpx.AsyncClient(timeout=10) as client:
                        res = await client.get(
                            f"https://finance.naver.com/item/sise_day.naver?code={code}",
                            headers={"User-Agent": "Mozilla/5.0"},
                        )
                    if res.status_code == 200:
                        import re
                        text = res.content.decode("euc-kr", errors="replace")
                        prices = re.findall(r'<span class="tah p11">\s*([\d,]+)\s*</span>', text)
                        if prices:
                            item = {**item, "price": int(prices[0].replace(",", ""))}
                except Exception:
                    pass
                return item

    # 3) 해외 주식 (yfinance)
    return await _get_foreign_price(code)
