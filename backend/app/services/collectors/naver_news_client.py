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

    async def count(self, query: str) -> int:
        """검색 총 건수(테마-종목 공출현 강도 정량화용)."""
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
            return 0
        return int(res.json().get("total", 0))
