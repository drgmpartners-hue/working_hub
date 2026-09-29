"""기사 본문 읽기 — 목록에서 제목을 누르면 그 자리에서 펼쳐 보여줄 본문을 가져온다.

- 원문 페이지를 서버가 받아 광고·메뉴를 뺀 본문만 추출(trafilatura)
- 구글 뉴스 RSS 링크(news.google.com/rss/articles/…)는 실제 기사 주소로 풀어서 연다
- 결과는 메모리에 6시간 보관(같은 기사를 여러 번 열어도 한 번만 받음)
- 실패하면 ok=False와 이유를 돌려주고, 화면은 '원문 새 창' 링크를 보여준다
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from collections import OrderedDict
from typing import Optional
from urllib.parse import quote, urlparse

import httpx

logger = logging.getLogger(__name__)

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/128.0.0.0 Safari/537.36")
HEADERS = {"User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
           "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"}
TIMEOUT = 12.0
MAX_BYTES = 3_000_000
MIN_CHARS = 120
MAX_CHARS = 20_000

_CACHE: "OrderedDict[str, tuple[float, dict]]" = OrderedDict()
_CACHE_MAX = 300
_CACHE_TTL = 6 * 3600
_FAIL_TTL = 10 * 60


def _cache_get(key: str) -> Optional[dict]:
    hit = _CACHE.get(key)
    if not hit:
        return None
    exp, val = hit
    if exp < time.time():
        _CACHE.pop(key, None)
        return None
    _CACHE.move_to_end(key)
    return val


def _cache_put(key: str, val: dict) -> None:
    _CACHE[key] = (time.time() + (_CACHE_TTL if val.get("ok") else _FAIL_TTL), val)
    _CACHE.move_to_end(key)
    while len(_CACHE) > _CACHE_MAX:
        _CACHE.popitem(last=False)


# ---------------------------------------------------------------- 구글 뉴스 링크 풀기
_GN_RE = re.compile(r"news\.google\.com/(?:rss/)?(?:articles|read)/([^?/#]+)")


def google_article_id(url: str) -> Optional[str]:
    m = _GN_RE.search(url or "")
    return m.group(1) if m else None


def _parse_batchexecute(text: str) -> Optional[str]:
    """batchexecute 응답에서 원문 주소를 꺼낸다(순수 함수)."""
    try:
        chunk = text.split("\n\n", 1)[1]
        outer = json.loads(chunk)
        for row in outer:
            if isinstance(row, list) and len(row) > 2 and isinstance(row[2], str) and "garturlres" in row[2]:
                inner = json.loads(row[2])
                if isinstance(inner, list) and len(inner) > 1 and str(inner[1]).startswith("http"):
                    return inner[1]
    except Exception:  # noqa: BLE001
        return None
    return None


async def resolve_google(client: httpx.AsyncClient, url: str) -> Optional[str]:
    gid = google_article_id(url)
    if not gid:
        return None
    try:
        page = await client.get(f"https://news.google.com/rss/articles/{gid}", headers=HEADERS)
        sig = re.search(r'data-n-a-sg="([^"]+)"', page.text)
        ts = re.search(r'data-n-a-ts="([^"]+)"', page.text)
        if not (sig and ts):
            return None
        req = ["Fbv4je", (
            '["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],'
            f'"X","X",1,[1,1,1],1,1,null,0,0,null,0],"{gid}",{ts.group(1)},"{sig.group(1)}"]'
        )]
        res = await client.post(
            "https://news.google.com/_/DotsSplashUi/data/batchexecute",
            headers={**HEADERS, "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"},
            content=f"f.req={quote(json.dumps([[req]]))}",
        )
        return _parse_batchexecute(res.text)
    except Exception as e:  # noqa: BLE001
        logger.info("google news decode failed: %s", e)
        return None


# ---------------------------------------------------------------- 본문 추출
def extract(html: bytes | str, url: str = "") -> dict:
    """HTML → {title, paragraphs, chars}(순수 함수, 스레드에서 호출)."""
    import trafilatura

    text = trafilatura.extract(
        html, url=url or None, output_format="txt", include_comments=False, include_tables=False,
        include_images=False, include_links=False, favor_recall=True, deduplicate=True,
    ) or ""
    title = ""
    try:
        meta = trafilatura.extract_metadata(html, default_url=url or None)
        title = (meta.title or "") if meta else ""
    except Exception:  # noqa: BLE001
        pass
    paras = [re.sub(r"\s+", " ", p).strip() for p in text.split("\n")]
    paras = [p for p in paras if p]
    out, total = [], 0
    for p in paras:
        if total + len(p) > MAX_CHARS:
            out.append("…(이하 생략 — 원문에서 확인)")
            break
        out.append(p)
        total += len(p)
    return {"title": title, "paragraphs": out, "chars": total}


async def _fetch(client: httpx.AsyncClient, url: str) -> tuple[bytes, str]:
    async with client.stream("GET", url, headers=HEADERS) as res:
        res.raise_for_status()
        ctype = res.headers.get("content-type", "")
        if ctype and "html" not in ctype and "xml" not in ctype:
            raise ValueError(f"기사 페이지가 아닙니다({ctype.split(';')[0]})")
        buf = bytearray()
        async for chunk in res.aiter_bytes():
            buf.extend(chunk)
            if len(buf) > MAX_BYTES:
                break
        return bytes(buf), str(res.url)


async def read(url: str) -> dict:
    """{ok, url(최종 주소), title, paragraphs, error}"""
    url = (url or "").strip()
    cached = _cache_get(url)
    if cached:
        return cached
    p = urlparse(url)
    if p.scheme not in ("http", "https") or not p.netloc:
        return {"ok": False, "url": url, "error": "기사 주소가 올바르지 않습니다."}
    result: dict
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True) as client:
            target = url
            if google_article_id(url):
                target = await resolve_google(client, url) or url
            html, final = await _fetch(client, target)
        data = await asyncio.to_thread(extract, html, final)
        if data["chars"] < MIN_CHARS:
            result = {"ok": False, "url": final, "error": "이 사이트는 본문을 자동으로 읽을 수 없습니다."}
        else:
            result = {"ok": True, "url": final, **data}
    except httpx.TimeoutException:
        result = {"ok": False, "url": url, "error": "기사 사이트가 응답하지 않습니다."}
    except httpx.HTTPStatusError as e:
        result = {"ok": False, "url": url, "error": f"기사 사이트가 열람을 막았습니다({e.response.status_code})."}
    except Exception as e:  # noqa: BLE001
        logger.info("article read failed %s: %s", url, e)
        result = {"ok": False, "url": url, "error": "본문을 가져오지 못했습니다."}
    _cache_put(url, result)
    return result
