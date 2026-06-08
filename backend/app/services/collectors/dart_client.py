"""DART OpenAPI 클라이언트 (재무·공시).

- corp_code 마스터(corpCode.xml zip)를 1회 다운로드해 stock_code→corp_code 매핑 캐시.
- 재무제표(fnlttSinglAcntAll)에서 매출액·영업이익 trend 추출 (당기/전기/전전기 = 3개년).
- 최근 공시 목록(list.json).
"""
from __future__ import annotations

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
