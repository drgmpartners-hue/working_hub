"""구글 뉴스 RSS — 날짜 구간 검색(기획 7-5).

https://news.google.com/rss/search?q=검색어+after:YYYY-MM-DD+before:YYYY-MM-DD&hl=ko&gl=KR&ceid=KR:ko
- 한 번에 최대 100건. 구간이 100건에 닿으면 반으로(주 → 일) 쪼개 다시 검색한다
- 링크는 구글 중계 주소라 원문 URL과 다르다 → 네이버 기사와는 제목 유사도로 같은 기사를 판단한다
- 비공식 기능이라 실패하면 빈 결과로 넘어간다(백필 결과서에 기록)
"""
from __future__ import annotations

import asyncio
import logging
import re
from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from html import unescape
from typing import Optional
from urllib.parse import quote
from xml.etree import ElementTree

import httpx

logger = logging.getLogger(__name__)

BASE = "https://news.google.com/rss/search"
CAP = 100
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; WorkingHub/1.0)"}
_KST = timezone(timedelta(hours=9))


def build_url(query: str, after: date, before: date) -> str:
    q = f"{query} after:{after.isoformat()} before:{before.isoformat()}"
    return f"{BASE}?q={quote(q)}&hl=ko&gl=KR&ceid=KR:ko"


def parse_rss(xml_text: str) -> list[dict]:
    """RSS → [{title, url, press, published_at(KST naive), description}] (순수 함수)."""
    root = ElementTree.fromstring(xml_text)
    out = []
    for it in root.iter("item"):
        title = unescape((it.findtext("title") or "").strip())
        src = it.find("source")
        press = (src.text or "").strip() if src is not None and src.text else None
        if press and title.endswith(f" - {press}"):
            title = title[: -len(press) - 3].strip()
        pub = None
        raw = it.findtext("pubDate")
        if raw:
            try:
                d = parsedate_to_datetime(raw)
                pub = d.astimezone(_KST).replace(tzinfo=None) if d.tzinfo else d
            except (TypeError, ValueError):
                pub = None
        desc = re.sub(r"<[^>]+>", " ", unescape(it.findtext("description") or ""))
        out.append({"title": title, "url": (it.findtext("link") or "").strip(), "press": press, "published_at": pub,
                    "description": re.sub(r"\s+", " ", desc).strip()[:300], "source": "google_rss"})
    return out


async def _fetch(client: httpx.AsyncClient, query: str, after: date, before: date) -> list[dict]:
    res = await client.get(build_url(query, after, before), headers=HEADERS)
    res.raise_for_status()
    return parse_rss(res.text)


async def search_range(query: str, start: date, end: date, *, step_days: int = 7, pause: float = 0.6,
                       client: Optional[httpx.AsyncClient] = None) -> dict:
    """[start, end] 전체를 step_days 구간으로 나눠 검색. 100건에 닿은 구간은 반으로 쪼갠다.

    반환: {items, windows, saturated: [하루 단위인데도 100건인 날], errors}
    """
    own = client is None
    client = client or httpx.AsyncClient(timeout=20, follow_redirects=True)
    items: list[dict] = []
    saturated: list[str] = []
    errors = 0
    windows = 0
    queue: list[tuple[date, date]] = []
    d = start
    while d <= end:
        e = min(end, d + timedelta(days=step_days - 1))
        queue.append((d, e))
        d = e + timedelta(days=1)
    try:
        while queue:
            a, b = queue.pop(0)
            windows += 1
            try:
                # before는 그날을 포함하지 않으므로 +1일
                got = await _fetch(client, query, a, b + timedelta(days=1))
            except Exception as ex:
                errors += 1
                logger.info("구글 RSS 실패 %s %s~%s: %s", query, a, b, ex)
                await asyncio.sleep(pause * 2)
                continue
            if len(got) >= CAP:
                if a < b:
                    mid = a + (b - a) // 2
                    queue[:0] = [(a, mid), (mid + timedelta(days=1), b)]
                    continue
                saturated.append(a.isoformat())
            items += got
            await asyncio.sleep(pause)
    finally:
        if own:
            await client.aclose()
    return {"items": items, "windows": windows, "saturated": saturated, "errors": errors}
