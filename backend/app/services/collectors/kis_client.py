"""한국투자증권(KIS) Open API 클라이언트.

- OAuth 토큰: 발급 횟수 제한(분당/일당) 때문에 파일 캐시 사용 (08 §5 함정 #4).
- 일봉 OHLCV: 수정주가(FID_ORG_ADJ_PRC=0)로 통일 (함정 #1).
- 현재가/밸류에이션(PER·PBR·EPS).
"""
from __future__ import annotations

import asyncio
import json
import hashlib
import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

_BASE = "https://openapi.koreainvestment.com:9443"
_CACHE_DIR = Path(__file__).resolve().parents[3] / ".cache"
_CACHE_DIR.mkdir(exist_ok=True)

# KIS 초당 거래건수 제한(EGW00201) 회피용 호출 간격(초)
_CALL_INTERVAL = 0.4


class KISClient:
    """KIS API 클라이언트. app_key/app_secret 단위로 토큰 캐시."""

    def __init__(self, app_key: str, app_secret: str):
        self.app_key = app_key
        self.app_secret = app_secret
        self._token_file = _CACHE_DIR / f"kis_token_{hashlib.md5(app_key.encode()).hexdigest()[:12]}.json"

    # ------------------------------------------------------------------ token
    def _load_cached_token(self) -> Optional[str]:
        if not self._token_file.exists():
            return None
        try:
            data = json.loads(self._token_file.read_text(encoding="utf-8"))
            expires_at = datetime.fromisoformat(data["expires_at"])
            if datetime.now() < expires_at - timedelta(minutes=10):
                return data["access_token"]
        except Exception:
            return None
        return None

    def _save_token(self, token: str, expires_in: int) -> None:
        try:
            self._token_file.write_text(
                json.dumps(
                    {
                        "access_token": token,
                        "expires_at": (datetime.now() + timedelta(seconds=expires_in)).isoformat(),
                    }
                ),
                encoding="utf-8",
            )
        except Exception as e:
            logger.warning("KIS 토큰 캐시 저장 실패: %s", e)

    async def _get_token(self) -> str:
        cached = self._load_cached_token()
        if cached:
            return cached
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.post(
                f"{_BASE}/oauth2/tokenP",
                json={
                    "grant_type": "client_credentials",
                    "appkey": self.app_key,
                    "appsecret": self.app_secret,
                },
            )
        if res.status_code != 200 or not res.json().get("access_token"):
            raise RuntimeError(f"KIS 토큰 발급 실패 (status={res.status_code}): {res.text[:120]}")
        data = res.json()
        token = data["access_token"]
        self._save_token(token, int(data.get("expires_in", 86400)))
        return token

    async def _headers(self, tr_id: str) -> dict:
        token = await self._get_token()
        return {
            "content-type": "application/json; charset=utf-8",
            "authorization": f"Bearer {token}",
            "appkey": self.app_key,
            "appsecret": self.app_secret,
            "tr_id": tr_id,
            "custtype": "P",
        }

    # ----------------------------------------------------------------- daily
    async def _fetch_chunk(
        self,
        client: httpx.AsyncClient,
        *,
        path: str,
        tr_id: str,
        mrkt_div: str,
        iscd: str,
        close_key: str,
        start: str,
        end: str,
        extra: dict | None = None,
    ) -> list[dict]:
        params = {
            "FID_COND_MRKT_DIV_CODE": mrkt_div,
            "FID_INPUT_ISCD": iscd,
            "FID_INPUT_DATE_1": start,
            "FID_INPUT_DATE_2": end,
            "FID_PERIOD_DIV_CODE": "D",
            **(extra or {}),
        }
        url = f"{_BASE}{path}"
        for attempt in range(3):
            await asyncio.sleep(_CALL_INTERVAL)
            res = await client.get(url, headers=await self._headers(tr_id), params=params)
            body = res.json() if res.status_code == 200 else {}
            if res.status_code != 200 or body.get("msg_cd") == "EGW00201":  # 초당 초과 → 백오프
                if attempt < 2:
                    await asyncio.sleep(0.6 * (attempt + 1))
                    continue
                raise RuntimeError(f"KIS 조회 실패 (status={res.status_code}): {res.text[:120]}")
            out: list[dict] = []
            for r in body.get("output2") or []:
                if not r.get(close_key):
                    continue
                out.append(
                    {
                        "date": r.get("stck_bsop_date"),
                        "close": float(r[close_key]),
                        "open": float(r.get("stck_oprc") or 0),
                        "high": float(r.get("stck_hgpr") or 0),
                        "low": float(r.get("stck_lwpr") or 0),
                        "volume": int(float(r.get("acml_vol") or 0)),
                    }
                )
            return out
        raise RuntimeError("KIS 조회 실패 (재시도 초과)")

    async def _paginate(self, *, path: str, tr_id: str, mrkt_div: str, iscd: str,
                        close_key: str, min_rows: int, extra: dict | None = None) -> list[dict]:
        merged: dict[str, dict] = {}
        end = datetime.now()
        max_pages = max(2, (min_rows // 90) + 2)
        async with httpx.AsyncClient(timeout=15) as client:
            for _ in range(max_pages):
                start = end - timedelta(days=140)
                chunk = await self._fetch_chunk(
                    client, path=path, tr_id=tr_id, mrkt_div=mrkt_div, iscd=iscd,
                    close_key=close_key, start=start.strftime("%Y%m%d"),
                    end=end.strftime("%Y%m%d"), extra=extra,
                )
                if not chunk:
                    break
                for row in chunk:
                    merged[row["date"]] = row
                if len(merged) >= min_rows:
                    break
                end = datetime.strptime(min(r["date"] for r in chunk), "%Y%m%d") - timedelta(days=1)
        return sorted(merged.values(), key=lambda x: x["date"])  # 오래된→최신

    async def get_daily_ohlcv(self, code: str, min_rows: int = 140) -> list[dict]:
        """종목 일봉 OHLCV(수정주가). 오래된→최신. {date, close, open, high, low, volume}."""
        return await self._paginate(
            path="/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice",
            tr_id="FHKST03010100", mrkt_div="J", iscd=code, close_key="stck_clpr",
            min_rows=min_rows, extra={"FID_ORG_ADJ_PRC": "0"},
        )

    async def get_index_closes(self, index_code: str = "0001", min_rows: int = 140) -> list[dict]:
        """지수 일봉(기본 KOSPI=0001). 벤치마크용. {date, close}."""
        return await self._paginate(
            path="/uapi/domestic-stock/v1/quotations/inquire-daily-indexchartprice",
            tr_id="FHKUP03500100", mrkt_div="U", iscd=index_code, close_key="bstp_nmix_prpr",
            min_rows=min_rows,
        )

    # ----------------------------------------------------------------- price
    async def get_price_info(self, code: str) -> dict:
        """현재가·등락률·PER·PBR·EPS·시총 반환."""
        await asyncio.sleep(_CALL_INTERVAL)
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.get(
                f"{_BASE}/uapi/domestic-stock/v1/quotations/inquire-price",
                headers=await self._headers("FHKST01010100"),
                params={"FID_COND_MRKT_DIV_CODE": "J", "FID_INPUT_ISCD": code},
            )
        if res.status_code != 200:
            raise RuntimeError(f"KIS 현재가 조회 실패 (status={res.status_code}): {res.text[:120]}")
        o = res.json().get("output") or {}

        def _f(v):
            try:
                return float(v)
            except (TypeError, ValueError):
                return None

        return {
            "current_price": _f(o.get("stck_prpr")),
            "change_rate": _f(o.get("prdy_ctrt")),
            "per": _f(o.get("per")),
            "pbr": _f(o.get("pbr")),
            "eps": _f(o.get("eps")),
            "market_cap": _f(o.get("hts_avls")),  # 시가총액(억)
            "name": o.get("rprs_mrkt_kor_name") or None,
        }

    # --------------------------------------------------------------- 수급
    async def get_investor_trend(self, code: str) -> dict:
        """외국인·기관 순매수 동향(최근). 반환: {foreign_net, institution_net, recent:[{date,foreign,institution}]}."""
        await asyncio.sleep(_CALL_INTERVAL)
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.get(
                f"{_BASE}/uapi/domestic-stock/v1/quotations/inquire-investor",
                headers=await self._headers("FHKST01010900"),
                params={"FID_COND_MRKT_DIV_CODE": "J", "FID_INPUT_ISCD": code},
            )
        if res.status_code != 200:
            return {}
        rows = res.json().get("output") or []

        def _i(v):
            try:
                return int(float(v))
            except (TypeError, ValueError):
                return 0

        recent = []
        f_sum = 0
        i_sum = 0
        for r in rows[:20]:
            f = _i(r.get("frgn_ntby_qty"))   # 외국인 순매수 수량
            inst = _i(r.get("orgn_ntby_qty"))  # 기관 순매수 수량
            f_sum += f
            i_sum += inst
            recent.append({"date": r.get("stck_bsop_date"), "foreign": f, "institution": inst})
        return {"foreign_net": f_sum, "institution_net": i_sum, "recent": recent}

    async def get_investor_flows(self, code: str) -> list[dict]:
        """투자자별 순매수 '금액'(원) 일별 — 외국인/기관/개인. 보고서 수급 섹션용.

        반환: [{date, foreign, institution, individual}] (금액, 원). 최근→과거 순.
        """
        await asyncio.sleep(_CALL_INTERVAL)
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.get(
                f"{_BASE}/uapi/domestic-stock/v1/quotations/inquire-investor",
                headers=await self._headers("FHKST01010900"),
                params={"FID_COND_MRKT_DIV_CODE": "J", "FID_INPUT_ISCD": code},
            )
        if res.status_code != 200:
            return []

        def _i(v):
            try:
                return int(float(v))
            except (TypeError, ValueError):
                return 0

        out = []
        for r in (res.json().get("output") or [])[:20]:
            out.append({
                "date": r.get("stck_bsop_date"),
                "foreign": _i(r.get("frgn_ntby_tr_pbmn")),       # 외국인 순매수 금액(원)
                "institution": _i(r.get("orgn_ntby_tr_pbmn")),   # 기관
                "individual": _i(r.get("prsn_ntby_tr_pbmn")),    # 개인
            })
        return out

    # ------------------------------------------------------------- financials
    async def get_financial_ratio(self, code: str) -> dict:
        """재무비율(ROE 등). 최근 결산 기준. 실패/없음 시 빈 dict."""
        await asyncio.sleep(_CALL_INTERVAL)
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.get(
                f"{_BASE}/uapi/domestic-stock/v1/finance/financial-ratio",
                headers=await self._headers("FHKST66430300"),
                params={
                    "FID_DIV_CLS_CODE": "0",
                    "fid_cond_mrkt_div_code": "J",
                    "fid_input_iscd": code,
                },
            )
        if res.status_code != 200:
            return {}
        rows = res.json().get("output") or []
        if not rows:
            return {}
        latest = rows[0]

        def _f(v):
            try:
                return float(v)
            except (TypeError, ValueError):
                return None

        return {
            "roe": _f(latest.get("roe_val")),
            "eps": _f(latest.get("eps")),
            "bps": _f(latest.get("bps")),
            "sales_growth": _f(latest.get("grs")),  # 매출액증가율
        }
