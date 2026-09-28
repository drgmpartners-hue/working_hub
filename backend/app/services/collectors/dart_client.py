"""DART OpenAPI 클라이언트 (재무·공시).

- corp_code 마스터(corpCode.xml zip)를 1회 다운로드해 stock_code→corp_code 매핑 캐시.
- 재무제표(fnlttSinglAcntAll)에서 매출액·영업이익 trend 추출 (당기/전기/전전기 = 3개년).
- 최근 공시 목록(list.json).
"""
from __future__ import annotations

import asyncio
import io
import json
import zipfile
import logging
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

_BASE = "https://opendart.fss.or.kr/api"
_CACHE_DIR = Path(__file__).resolve().parents[3] / ".cache"
_CACHE_DIR.mkdir(exist_ok=True)
_CORP_MAP_FILE = _CACHE_DIR / "dart_corpmap.json"


def _num(v) -> Optional[float]:
    try:
        return float(str(v).replace(",", ""))
    except (TypeError, ValueError):
        return None


class DARTClient:
    def __init__(self, api_key: str):
        self.api_key = api_key

    # ----------------------------------------------------------- corp map
    async def _load_corp_map(self) -> dict[str, str]:
        """stock_code(6자리) → corp_code(8자리). 캐시 우선."""
        if _CORP_MAP_FILE.exists():
            try:
                return json.loads(_CORP_MAP_FILE.read_text(encoding="utf-8"))
            except Exception:
                pass
        async with httpx.AsyncClient(timeout=30) as client:
            res = await client.get(f"{_BASE}/corpCode.xml", params={"crtfc_key": self.api_key})
        if res.status_code != 200:
            raise RuntimeError(f"DART corpCode 다운로드 실패 (status={res.status_code})")
        with zipfile.ZipFile(io.BytesIO(res.content)) as zf:
            xml_bytes = zf.read(zf.namelist()[0])
        root = ET.fromstring(xml_bytes)
        mapping: dict[str, str] = {}
        for item in root.iter("list"):
            stock_code = (item.findtext("stock_code") or "").strip()
            corp_code = (item.findtext("corp_code") or "").strip()
            if stock_code and corp_code:
                mapping[stock_code] = corp_code
        if mapping:
            _CORP_MAP_FILE.write_text(json.dumps(mapping), encoding="utf-8")
        return mapping

    async def get_corp_code(self, stock_code: str) -> Optional[str]:
        return (await self._load_corp_map()).get(stock_code)

    # ----------------------------------------------------------- financials
    async def get_financials(self, stock_code: str, year: Optional[int] = None) -> dict:
        """매출액·영업이익 trend(당기/전기/전전기) 반환.

        반환: {revenue_trend:[{period,value}], operating_profit_trend:[{period,value}]}
        """
        corp_code = await self.get_corp_code(stock_code)
        if not corp_code:
            return {}

        years = [year] if year else [2025, 2024]
        data = None
        for y in years:
            async with httpx.AsyncClient(timeout=15) as client:
                res = await client.get(
                    f"{_BASE}/fnlttSinglAcntAll.json",
                    params={
                        "crtfc_key": self.api_key,
                        "corp_code": corp_code,
                        "bsns_year": str(y),
                        "reprt_code": "11011",  # 사업보고서(연간)
                        "fs_div": "CFS",         # 연결재무제표
                    },
                )
            if res.status_code == 200 and res.json().get("status") == "000":
                data = res.json()
                break
        if not data:
            return {}

        rows = data.get("list") or []
        revenue, op = None, None
        for r in rows:
            nm = (r.get("account_nm") or "").replace(" ", "")
            if nm in ("매출액", "영업수익", "수익(매출액)") and revenue is None:
                revenue = r
            elif nm == "영업이익" and op is None:
                op = r

        def _trend(row) -> list[dict]:
            if not row:
                return []
            out = []
            for key, label in (("bfefrmtrm_amount", "전전기"), ("frmtrm_amount", "전기"), ("thstrm_amount", "당기")):
                val = _num(row.get(key))
                if val is not None:
                    out.append({"period": label, "value": val})
            return out

        return {
            "revenue_trend": _trend(revenue),
            "operating_profit_trend": _trend(op),
        }

    # --------------------------------------------------------------- 공시
    async def get_disclosures(self, stock_code: str, count: int = 5) -> list[dict]:
        """최근 공시 목록."""
        corp_code = await self.get_corp_code(stock_code)
        if not corp_code:
            return []
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.get(
                f"{_BASE}/list.json",
                params={"crtfc_key": self.api_key, "corp_code": corp_code, "page_count": count},
            )
        if res.status_code != 200 or res.json().get("status") not in ("000", "013"):
            return []
        return [
            {
                "report_nm": d.get("report_nm"),
                "rcept_dt": d.get("rcept_dt"),
                "flr_nm": d.get("flr_nm"),
            }
            for d in (res.json().get("list") or [])
        ]

    # ------------------------------------------------ 기업 리포트(비상장 포함)
    async def _load_corp_list(self) -> list[dict]:
        """DART 등록 회사 전체(비상장 포함) [{corp_code, corp_name, corp_eng_name, stock_code, _n, _e}].

        corpCode.xml(약 10만 건)을 내려받아 파일로 7일 캐시하고, 프로세스 메모리에도 한 번만 올린다.
        큰 XML 해석·JSON 읽기는 별도 스레드에서 해서 다른 요청이 멈추지 않게 한다.
        """
        import time

        global _CORP_MEM, _CORP_MEM_AT
        if _CORP_MEM is not None and time.time() - _CORP_MEM_AT < 7 * 86400:
            return _CORP_MEM
        async with _CORP_LOCK:
            if _CORP_MEM is not None and time.time() - _CORP_MEM_AT < 7 * 86400:
                return _CORP_MEM
            rows = None
            if _CORP_LIST_FILE.exists() and time.time() - _CORP_LIST_FILE.stat().st_mtime < 7 * 86400:
                try:
                    rows = await asyncio.to_thread(lambda: json.loads(_CORP_LIST_FILE.read_text(encoding="utf-8")))
                except Exception:
                    rows = None
            if rows is None:
                async with httpx.AsyncClient(timeout=60) as client:
                    res = await client.get(f"{_BASE}/corpCode.xml", params={"crtfc_key": self.api_key})
                if res.status_code != 200:
                    raise RuntimeError(f"DART corpCode 다운로드 실패 (status={res.status_code})")
                rows = await asyncio.to_thread(_parse_corp_zip, res.content)
            await asyncio.to_thread(_index_rows, rows)
            _CORP_MEM, _CORP_MEM_AT = rows, time.time()
            return rows

    async def search_corps(self, query: str, limit: int = 10) -> list[dict]:
        """회사명(국문·영문) 부분 일치 검색. 정확히 같은 이름 → 앞부분 일치 → 포함 순."""
        q = normalize_corp_name(query)
        if not q:
            return []
        rows = await self._load_corp_list()
        return await asyncio.to_thread(_match_rows, rows, q, limit)

    async def get_company(self, corp_code: str) -> dict:
        """기업개황(company.json). 실패 시 빈 dict."""
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.get(f"{_BASE}/company.json", params={"crtfc_key": self.api_key, "corp_code": corp_code})
        if res.status_code != 200:
            return {}
        d = res.json()
        if d.get("status") != "000":
            return {}
        return d

    async def list_disclosures(self, corp_code: str, bgn_de: str, end_de: str, max_pages: int = 10) -> list[dict]:
        """기간 공시 목록(YYYYMMDD). 페이지를 끝까지 넘긴다."""
        out: list[dict] = []
        async with httpx.AsyncClient(timeout=15) as client:
            for page in range(1, max_pages + 1):
                res = await client.get(
                    f"{_BASE}/list.json",
                    params={
                        "crtfc_key": self.api_key, "corp_code": corp_code,
                        "bgn_de": bgn_de, "end_de": end_de, "page_no": page, "page_count": 100,
                    },
                )
                if res.status_code != 200:
                    break
                d = res.json()
                if d.get("status") != "000":
                    break
                out.extend(d.get("list") or [])
                if page >= int(d.get("total_page") or 1):
                    break
        return out


_CORP_LIST_FILE = _CACHE_DIR / "dart_corplist.json"

_CORP_SUFFIX_RE = __import__("re").compile(r"\(주\)|㈜|주식회사|\(유\)|유한회사|\s+|[.,·]")


def normalize_corp_name(name: str) -> str:
    """'(주)에이비씨 바이오' → '에이비씨바이오' (비교용)."""
    return _CORP_SUFFIX_RE.sub("", (name or "")).lower()


_CORP_MEM: Optional[list] = None
_CORP_MEM_AT: float = 0.0
_CORP_LOCK = asyncio.Lock()


def _parse_corp_zip(content: bytes) -> list[dict]:
    """corpCode.xml(zip) → 목록. 파일 캐시와 상장사 매핑 캐시도 갱신(스레드에서 실행)."""
    with zipfile.ZipFile(io.BytesIO(content)) as zf:
        xml_bytes = zf.read(zf.namelist()[0])
    root = ET.fromstring(xml_bytes)
    rows: list[dict] = []
    mapping: dict[str, str] = {}
    for item in root.iter("list"):
        code = (item.findtext("corp_code") or "").strip()
        name = (item.findtext("corp_name") or "").strip()
        if not code or not name:
            continue
        stock = (item.findtext("stock_code") or "").strip()
        rows.append({"corp_code": code, "corp_name": name,
                     "corp_eng_name": (item.findtext("corp_eng_name") or "").strip(), "stock_code": stock})
        if stock:
            mapping[stock] = code
    del root
    _CORP_LIST_FILE.parent.mkdir(parents=True, exist_ok=True)
    _CORP_LIST_FILE.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
    if mapping:
        _CORP_MAP_FILE.write_text(json.dumps(mapping), encoding="utf-8")
    return rows


def _index_rows(rows: list[dict]) -> None:
    """검색용 정규화 이름을 미리 계산(검색할 때마다 10만 번 정규식을 돌리지 않게)."""
    for r in rows:
        if "_n" not in r:
            r["_n"] = normalize_corp_name(r["corp_name"])
            r["_e"] = normalize_corp_name(r.get("corp_eng_name") or "")


def _match_rows(rows: list[dict], q: str, limit: int) -> list[dict]:
    exact, prefix, contains = [], [], []
    for r in rows:
        n, e = r["_n"], r["_e"]
        if q == n or (e and q == e):
            exact.append(r)
        elif n.startswith(q) or (e and e.startswith(q)):
            prefix.append(r)
        elif q in n or (e and q in e):
            contains.append(r)
    key = lambda r: (0 if r.get("stock_code") else 1, len(r["corp_name"]))  # noqa: E731  상장사·짧은 이름 우선
    out = sorted(exact, key=key) + sorted(prefix, key=key) + sorted(contains, key=key)
    return [{k: v for k, v in r.items() if not k.startswith("_")} for r in out[:limit]]


def dart_disclosure_url(rcept_no: str) -> str:
    return f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={rcept_no}"
