"""네이버 검색 OpenAPI(뉴스) 클라이언트.

종목·테마 관련 뉴스 검색. 종목↔테마 공출현 정량화에도 활용 (08 §5).
"""
from __future__ import annotations

import re
import html
import logging

import httpx

logger = logging.getLogger(__name__)

_BASE = "https://openapi.naver.com/v1/search/news.json"
_TAG_RE = re.compile(r"<[^>]+>")


def _clean(text: str) -> str:
    return html.unescape(_TAG_RE.sub("", text or "")).strip()


class NaverNewsClient:
    def __init__(self, client_id: str, client_secret: str):
        self.client_id = client_id
        self.client_secret = client_secret

    async def search(self, query: str, display: int = 5, sort: str = "date") -> list[dict]:
        """뉴스 검색. 반환: [{title, link, description, pub_date}]."""
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.get(
                _BASE,
                params={"query": query, "display": display, "sort": sort},
                headers={
                    "X-Naver-Client-Id": self.client_id,
                    "X-Naver-Client-Secret": self.client_secret,
                },
            )
        if res.status_code != 200:
            raise RuntimeError(f"네이버 뉴스 검색 실패 (status={res.status_code}): {res.text[:120]}")
        items = res.json().get("items") or []
        return [
            {
                "title": _clean(it.get("title", "")),
                "link": it.get("originallink") or it.get("link", ""),
                "description": _clean(it.get("description", "")),
                "pub_date": it.get("pubDate", ""),
            }
            for it in items
        ]

    async def count(self, query: str) -> "int | None":
        """검색 총 건수(테마-종목 공출현 강도 정량화용). 실패하면 None — 예전엔 0 을 돌려줘 '기사 없음'과 구분이 안 됐다(P2-12)."""
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.get(
                _BASE,
                params={"query": query, "display": 1},
                headers={
                    "X-Naver-Client-Id": self.client_id,
                    "X-Naver-Client-Secret": self.client_secret,
                },
            )
        if res.status_code != 200:
            logger.warning("네이버 뉴스 건수 조회 실패 (status=%s)", res.status_code)
            return None
        return int(res.json().get("total", 0))


# ------------------------------------------------------------ 기업 리포트용 보강
from datetime import datetime as _dt
from email.utils import parsedate_to_datetime as _parse_rfc2822
from urllib.parse import urlparse as _urlparse


def parse_pubdate(value: str):
    """네이버 pubDate(RFC 2822, +0900) → KST naive datetime. 실패 시 None."""
    if not value:
        return None
    try:
        d = _parse_rfc2822(value)
        if d.tzinfo is not None:
            from datetime import timedelta, timezone

            d = d.astimezone(timezone(timedelta(hours=9))).replace(tzinfo=None)
        return d
    except Exception:
        return None


def press_from_url(url: str) -> str:
    """원문 URL 도메인에서 매체 추정(예: www.hankyung.com → hankyung.com)."""
    try:
        host = _urlparse(url).netloc.lower()
        return host[4:] if host.startswith("www.") else host
    except Exception:
        return ""


async def search_page(client_id: str, client_secret: str, query: str, *, start: int = 1,
                      display: int = 100, sort: str = "date") -> dict:
    """네이버 뉴스 한 페이지. 반환 {total, items:[{title, url, naver_link, description, published_at, press}]}.

    네이버 API는 start 최대 1000, display 최대 100이다(검색어당 최근 1,000건까지).
    """
    from app.services.collectors.http_retry import get_with_retry

    async with httpx.AsyncClient(timeout=10) as client:
        res = await get_with_retry(
            client, _BASE,
            params={"query": query, "display": min(display, 100), "start": min(max(start, 1), 1000), "sort": sort},
            headers={"X-Naver-Client-Id": client_id, "X-Naver-Client-Secret": client_secret},
            label="네이버 뉴스",
        )
    if res.status_code != 200:
        raise RuntimeError(f"네이버 뉴스 검색 실패 (status={res.status_code}): {res.text[:120]}")
    data = res.json()
    items = []
    for it in data.get("items") or []:
        url = it.get("originallink") or it.get("link", "")
        items.append({
            "title": _clean(it.get("title", "")),
            "url": url,
            "naver_link": it.get("link", ""),
            "description": _clean(it.get("description", "")),
            "published_at": parse_pubdate(it.get("pubDate", "")),
            "press": press_from_url(url),
        })
    return {"total": int(data.get("total", 0)), "items": items}


async def search_since(client_id: str, client_secret: str, query: str, since: "_dt | None",
                       max_items: int = 1000) -> dict:
    """최신순으로 넘기며 since 이후 기사만 모은다. 반환 {items, hit_limit, oldest}."""
    out: list[dict] = []
    start = 1
    hit_limit = False
    oldest = None
    while start <= 1000 and len(out) < max_items:
        page = await search_page(client_id, client_secret, query, start=start, display=100)
        items = page["items"]
        if not items:
            break
        stop = False
        for it in items:
            p = it["published_at"]
            if p and (oldest is None or p < oldest):
                oldest = p
            if since and p and p < since:
                stop = True
                continue
            out.append(it)
        if stop or len(items) < 100:
            break
        start += 100
        if start > 1000:
            hit_limit = True
    return {"items": out, "hit_limit": hit_limit, "oldest": oldest}
