"""공공데이터 클라이언트 — 국민연금 가입 사업장, 국세청 사업자 상태, KIPRIS 특허(P2-8).

응답은 JSON/XML이 섞여 있어 공통 파서(items/item → dict)를 쓴다. 키는 호출하는 쪽에서 넘긴다.
- 국민연금: 공공데이터포털 인증키(Decoding). 사업장 검색 → seq → 상세(가입자 수·고지액) → 기간별 현황(취득·상실)
- 국세청: 공공데이터포털 인증키. POST api.odcloud.kr/api/nts-businessman/v1/status, 한 번에 100건
- KIPRIS Plus: 별도 인증키. 출원인명으로 특허·실용신안 검색
"""
from __future__ import annotations

import logging
import re
from typing import Optional
from xml.etree import ElementTree

import httpx

logger = logging.getLogger(__name__)

NPS_BASES = [
    "https://apis.data.go.kr/B552015/NpsBplcInfoInqireService",
    "https://apis.data.go.kr/B552015/NpsBplcInfoInqireSvc",
]
NTS_STATUS_URL = "https://api.odcloud.kr/api/nts-businessman/v1/status"
KIPRIS_ADV_URL = "http://plus.kipris.or.kr/kipo-api/kipi/patUtiModInfoSearchSevice/getAdvancedSearch"


class PublicDataError(RuntimeError):
    pass


def _xml_items(text: str) -> tuple[list[dict], dict]:
    root = ElementTree.fromstring(text)
    header = {}
    for tag in ("resultCode", "resultMsg", "successYN", "totalCount", "returnAuthMsg", "errMsg"):
        el = root.find(f".//{tag}")
        if el is not None and el.text:
            header[tag] = el.text.strip()
    items = []
    for it in root.iter("item"):
        items.append({c.tag: (c.text or "").strip() for c in it})
    return items, header


def parse_items(res: httpx.Response) -> tuple[list[dict], dict]:
    """JSON(response.body.items.item) 또는 XML(item)을 [dict]로."""
    ct = res.headers.get("content-type", "")
    text = res.text
    if "json" in ct or text.lstrip().startswith("{"):
        data = res.json()
        body = (data.get("response") or {}).get("body") or data.get("body") or {}
        header = (data.get("response") or {}).get("header") or {}
        items = body.get("items") or {}
        it = items.get("item") if isinstance(items, dict) else items
        it = it or []
        if isinstance(it, dict):
            it = [it]
        header = {**header, "totalCount": body.get("totalCount")}
        return list(it), header
    try:
        return _xml_items(text)
    except ElementTree.ParseError as e:
        raise PublicDataError(f"응답 해석 실패: {text[:150]}") from e


def _check_header(header: dict, text_head: str = "") -> None:
    code = str(header.get("resultCode") or "00")
    if code not in ("00", "0", "000") or "SERVICE_KEY" in text_head or "SERVICE KEY" in text_head.upper():
        raise PublicDataError(f"{header.get('resultMsg') or header.get('returnAuthMsg') or text_head[:120]} (code={code})")


def normalize_name(name: str) -> str:
    n = re.sub(r"\(주\)|㈜|주식회사|\(유\)|유한회사|\(사\)|\s", "", name or "")
    return n.lower()


def digits(v: Optional[str]) -> str:
    return re.sub(r"\D", "", v or "")


# --------------------------------------------------------------------------- 국민연금

async def _nps_get(client: httpx.AsyncClient, key: str, op: str, params: dict) -> list[dict]:
    last: Exception | None = None
    for base in NPS_BASES:
        try:
            res = await client.get(f"{base}/{op}", params={"serviceKey": key, "numOfRows": 100, "pageNo": 1, **params})
            if res.status_code == 404:
                continue
            res.raise_for_status()
            items, header = parse_items(res)
            _check_header(header, res.text[:200])
            return items
        except (httpx.HTTPError, PublicDataError) as e:
            last = e
    raise PublicDataError(f"국민연금 API 실패({op}): {last}")


def pick_nps_workplace(items: list[dict], name: str, biz_reg_no: Optional[str]) -> Optional[dict]:
    """검색 결과 중 이 회사 사업장 고르기(순수 로직). 사업자번호 앞 6자리 > 이름 일치 > 가입 중·최신."""
    target = normalize_name(name)
    b6 = digits(biz_reg_no)[:6]
    def score(it: dict) -> tuple:
        n = normalize_name(it.get("wkplNm", ""))
        b = digits(it.get("bzowrRgstNo"))
        return (
            bool(b6) and b.startswith(b6),
            n == target,
            target in n or n in target,
            str(it.get("wkplJnngStcd", "1")) == "1",
            it.get("dataCrtYm", ""),
        )
    if b6:  # 사업자번호를 알면 앞 6자리가 맞는 사업장만(동명 회사 오인 방지)
        cands = [it for it in items if digits(it.get("bzowrRgstNo")).startswith(b6)]
    else:
        cands = [it for it in items if target and target in normalize_name(it.get("wkplNm", ""))]
    return max(cands, key=score) if cands else None


async def nps_snapshot(key: str, name: str, biz_reg_no: Optional[str]) -> dict:
    async with httpx.AsyncClient(timeout=15) as client:
        params = {"wkpl_nm": re.sub(r"\(주\)|㈜|주식회사", "", name).strip()}
        b6 = digits(biz_reg_no)[:6]
        if b6:
            params["bzowr_rgst_no"] = b6
        items = await _nps_get(client, key, "getBassInfoSearch", params)
        if not items and b6:  # 사업자번호로 못 찾으면 이름만으로
            items = await _nps_get(client, key, "getBassInfoSearch", {"wkpl_nm": params["wkpl_nm"]})
        wp = pick_nps_workplace(items, name, biz_reg_no)
        if not wp:
            return {"found": False, "candidates": len(items)}
        seq = wp.get("seq")
        detail = (await _nps_get(client, key, "getDetailInfoSearch", {"seq": seq}) or [{}])[0]
        period = {}
        try:
            period = (await _nps_get(client, key, "getPdAcctoSttusInfoSearch",
                                     {"seq": seq, "data_crt_ym": wp.get("dataCrtYm", "")}) or [{}])[0]
        except PublicDataError as e:
            logger.info("국민연금 기간별 현황 실패: %s", e)

        def _int(v):
            try:
                return int(float(v))
            except (TypeError, ValueError):
                return None

        return {
            "found": True, "seq": seq, "workplace": wp.get("wkplNm"), "biz_prefix": wp.get("bzowrRgstNo"),
            "data_month": wp.get("dataCrtYm"), "members": _int(detail.get("jnngpCnt")),
            "monthly_charge": _int(detail.get("crrmmNtcAmt")), "joined": _int(period.get("nwAcqzrCnt")),
            "left": _int(period.get("lssJnngpCnt")), "status": "가입" if str(wp.get("wkplJnngStcd", "1")) == "1" else "탈퇴",
            "address": detail.get("wkplRoadNmDtlAddr") or wp.get("wkplRoadNmDtlAddr"), "adopted_at": detail.get("adptDt"),
            "candidates": len(items),
        }


# --------------------------------------------------------------------------- 국세청

async def nts_status(key: str, biz_numbers: list[str]) -> dict[str, dict]:
    """{사업자번호(숫자10자리): {b_stt, b_stt_cd, tax_type, end_dt}}. 100건씩."""
    nums = [n for n in {digits(b) for b in biz_numbers} if len(n) == 10]
    out: dict[str, dict] = {}
    async with httpx.AsyncClient(timeout=15) as client:
        for i in range(0, len(nums), 100):
            chunk = nums[i : i + 100]
            res = await client.post(NTS_STATUS_URL, params={"serviceKey": key}, json={"b_no": chunk})
            if res.status_code >= 400:
                raise PublicDataError(f"국세청 API 오류 {res.status_code}: {res.text[:150]}")
            data = res.json()
            for row in data.get("data") or []:
                out[digits(row.get("b_no"))] = {
                    "b_stt": row.get("b_stt") or "등록되지 않은 사업자",
                    "b_stt_cd": row.get("b_stt_cd") or "",
                    "tax_type": row.get("tax_type") or "",
                    "end_dt": row.get("end_dt") or "",
                }
    return out


# --------------------------------------------------------------------------- KIPRIS

async def kipris_patents(key: str, applicant: str, max_pages: int = 2, rows: int = 100) -> dict:
    """출원인명으로 특허·실용신안 검색. 반환: {total, calls, items:[…최신순 상위]}"""
    items: list[dict] = []
    total = 0
    calls = 0
    async with httpx.AsyncClient(timeout=20) as client:
        for page in range(1, max_pages + 1):
            res = await client.get(KIPRIS_ADV_URL, params={
                "applicant": applicant, "patent": "true", "utility": "true", "numOfRows": rows, "pageNo": page,
                "sortSpec": "AD", "descSort": "true", "ServiceKey": key,
            })
            calls += 1
            res.raise_for_status()
            got, header = parse_items(res)
            if header.get("successYN") == "N":
                raise PublicDataError(f"KIPRIS 오류: {header.get('errMsg') or res.text[:150]}")
            try:
                total = int(header.get("totalCount") or total)
            except ValueError:
                pass
            items += got
            if len(items) >= total or len(got) < rows:
                break
    return {"total": total or len(items), "calls": calls, "items": items}


def summarize_patents(items: list[dict], company_name: str, today_iso: str) -> dict:
    """출원인명이 이 회사인 것만 남겨 집계(순수 로직)."""
    target = normalize_name(company_name)
    mine = [it for it in items if target and target in normalize_name(it.get("applicantName", ""))]
    year_ago = str(int(today_iso[:4]) - 1) + today_iso[5:7] + today_iso[8:10]
    def reg(it):
        return (it.get("registerStatus") or "") == "등록" or bool(it.get("registerNumber"))
    recent = sorted(mine, key=lambda x: x.get("applicationDate", ""), reverse=True)[:20]
    return {
        "total": len(mine),
        "registered": sum(1 for it in mine if reg(it)),
        "applied_12m": sum(1 for it in mine if (it.get("applicationDate") or "") >= year_ago),
        "recent": [{"title": it.get("inventionTitle"), "application_no": it.get("applicationNumber"),
                    "application_date": it.get("applicationDate"), "status": it.get("registerStatus"),
                    "register_no": it.get("registerNumber"), "ipc": (it.get("ipcNumber") or "").split("|")[0]} for it in recent],
    }
