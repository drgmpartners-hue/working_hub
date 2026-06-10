"""테마-종목 매핑 역설계 수집 (08-stock-etf-recommend §5).

네이버 금융 테마(finance.naver.com)에서 테마 목록 + 소속 종목을 수집한다.
결과는 .cache/theme_stock_map.json 에 캐시되어 theme_stock_map이 사용한다.
⚠️ 네이버 금융 HTML 스크래핑(EUC-KR). 구조 변경 시 패턴 갱신 필요. 레이트리밋 throttle.
"""
from __future__ import annotations

import re
import json
import asyncio
import logging
from pathlib import Path

import httpx

logger = logging.getLogger(__name__)

_BASE = "https://finance.naver.com"
_HEADERS = {"User-Agent": "Mozilla/5.0", "Referer": _BASE}
_CACHE_DIR = Path(__file__).resolve().parents[3] / ".cache"
_CACHE_DIR.mkdir(exist_ok=True)
_MAP_FILE = _CACHE_DIR / "theme_stock_map.json"

_THEME_LINK = re.compile(r'sise_group_detail\.naver\?type=theme&no=(\d+)\">([^<]+)</a>')
_ITEM_LINK = re.compile(r'/item/main\.naver\?code=(\d{6})\">([^<]+)</a>')
_CALL_INTERVAL = 0.3


def _decode(resp: httpx.Response) -> str:
    return resp.content.decode("euc-kr", "replace")


async def fetch_theme_list(client: httpx.AsyncClient, max_pages: int = 7) -> list[tuple[str, str]]:
    """(theme_no, theme_name) 목록. 페이지당 ~40개."""
    out: list[tuple[str, str]] = []
    seen: set[str] = set()
    for page in range(1, max_pages + 1):
        await asyncio.sleep(_CALL_INTERVAL)
        try:
            r = await client.get(f"{_BASE}/sise/theme.naver?page={page}", headers=_HEADERS)
        except Exception as e:
            logger.info("테마 목록 page=%s 실패: %s", page, e)
            break
        found = _THEME_LINK.findall(_decode(r))
        if not found:
            break
        for no, name in found:
            if no not in seen:
                seen.add(no)
                out.append((no, name.strip()))
    return out


async def fetch_theme_members(client: httpx.AsyncClient, theme_no: str, limit: int = 12) -> list[tuple[str, str]]:
    """테마 소속 종목 (code, name). 중복 제거."""
    await asyncio.sleep(_CALL_INTERVAL)
    try:
        r = await client.get(
            f"{_BASE}/sise/sise_group_detail.naver?type=theme&no={theme_no}", headers=_HEADERS
        )
    except Exception as e:
        logger.info("테마 상세 no=%s 실패: %s", theme_no, e)
        return []
    members: list[tuple[str, str]] = []
    seen: set[str] = set()
    for code, name in _ITEM_LINK.findall(_decode(r)):
        if code not in seen:
            seen.add(code)
            members.append((code, name.strip()))
        if len(members) >= limit:
            break
    return members


async def collect(max_pages: int = 7, members_per_theme: int = 12) -> dict[str, list[list[str]]]:
    """네이버 테마 전체 수집 → {theme_name: [[code, name], ...]} 캐시 저장 후 반환."""
    mapping: dict[str, list[list[str]]] = {}
    async with httpx.AsyncClient(timeout=15) as client:
        themes = await fetch_theme_list(client, max_pages)
        for no, name in themes:
            members = await fetch_theme_members(client, no, members_per_theme)
            if members:
                mapping[name] = [[c, n] for c, n in members]
    if mapping:
        _MAP_FILE.write_text(json.dumps(mapping, ensure_ascii=False), encoding="utf-8")
    return mapping


def load_cached_map() -> dict[str, list[list[str]]]:
    if _MAP_FILE.exists():
        try:
            return json.loads(_MAP_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


async def fetch_theme_no_map(max_pages: int = 7) -> dict[str, str]:
    """네이버 테마명 → 테마번호(no) 맵. 단일 테마 온디맨드 수집용."""
    async with httpx.AsyncClient(timeout=15) as client:
        themes = await fetch_theme_list(client, max_pages)
    return {name: no for no, name in themes}


async def collect_one(theme_no: str, limit: int = 12) -> list[list[str]]:
    """테마번호로 소속 종목 [[code,name],...] 수집."""
    async with httpx.AsyncClient(timeout=15) as client:
        members = await fetch_theme_members(client, theme_no, limit)
    return [[c, n] for c, n in members]


# 테마 행: 테마명 링크 ~ 다음 테마명 링크 직전까지를 한 블록으로
_ROW_SPLIT = re.compile(r'sise_group_detail\.naver\?type=theme&no=\d+">')
_PCT = re.compile(r'([+-]?\d+\.\d+)%')


async def fetch_theme_quotes(max_pages: int = 7) -> list[dict]:
    """네이버 테마 시세(장마감 기준) 일괄 수집.

    각 테마: {name, change_rate(전일대비 %), up_count, down_count}.
    KIS/KRX 불필요 — 테마 페이지 한 번 긁어 전 테마 가격신호 확보.
    """
    out: list[dict] = []
    seen: set[str] = set()
    async with httpx.AsyncClient(timeout=15) as client:
        for page in range(1, max_pages + 1):
            await asyncio.sleep(_CALL_INTERVAL)
            try:
                r = await client.get(f"{_BASE}/sise/theme.naver?page={page}", headers=_HEADERS)
            except Exception as e:
                logger.info("테마 시세 page=%s 실패: %s", page, e)
                break
            html = _decode(r)
            # 테마명 + 등락률 (검증된 패턴)
            pairs = re.findall(
                r'sise_group_detail\.naver\?type=theme&no=\d+">([^<]+)</a>.*?([+-]?\d+\.\d+)%',
                html, re.S,
            )
            if not pairs:
                break
            # 행 블록별로 상승/하락 종목수 추출(보합 포함 3개 정수 — 첫=상승, 끝=하락)
            blocks = _ROW_SPLIT.split(html)[1:]  # 각 테마 행 본문
            for idx, (name, chg) in enumerate(pairs):
                name = name.strip()
                if name in seen:
                    continue
                seen.add(name)
                up = down = None
                if idx < len(blocks):
                    blk = blocks[idx]
                    # 등락률 2개(전일대비·최근3일) 이후의 정수 셀들에서 상승/보합/하락
                    nums = re.findall(r'<td[^>]*class="?number[^>]*>\s*(\d+)\s*</td>', blk)
                    if len(nums) >= 3:
                        up, down = int(nums[0]), int(nums[2])
                    elif len(nums) >= 1:
                        up = int(nums[0])
                out.append({
                    "name": name,
                    "change_rate": float(chg),
                    "up_count": up,
                    "down_count": down,
                })
    return out
