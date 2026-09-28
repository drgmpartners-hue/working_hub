"""공공데이터포털(data.go.kr) — 특일 정보(공휴일)·기상청 단기예보.

- 특일 정보: 발송일 판단(평일·공휴일), 월간 브리핑 '1일이 휴일이면 다음 영업일'
- 기상청 단기예보: 브리핑 ① 기본 정보의 서울 날씨(최저·최고기온, 하늘, 강수확률)
키: user_api_keys provider "data_go_kr" (keys.get_service_key로 조회). 두 API 모두 활용 신청 필요.
"""
from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

HOLIDAY_URL = "https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo"
FORECAST_URL = "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst"

# 기상청 격자 좌표(서울 중구 기준)
REGIONS = {"서울": (60, 127)}

SKY = {"1": "맑음", "3": "구름많음", "4": "흐림"}
PTY = {"0": "", "1": "비", "2": "비/눈", "3": "눈", "4": "소나기"}

_holiday_cache: dict[tuple[int, int], dict[date, str]] = {}


def _items(payload: dict) -> list[dict]:
    body = (payload.get("response") or {}).get("body") or {}
    items = (body.get("items") or {}) if isinstance(body.get("items"), dict) else {}
    it = items.get("item") or []
    return it if isinstance(it, list) else [it]


async def get_holidays(service_key: Optional[str], year: int, month: int) -> dict[date, str]:
    """해당 월 공휴일 {날짜: 이름}. 키가 없거나 실패하면 빈 dict(주말만 휴일로 본다)."""
    k = (year, month)
    if k in _holiday_cache:
        return _holiday_cache[k]
    if not service_key:
        return {}
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.get(HOLIDAY_URL, params={
                "serviceKey": service_key, "solYear": str(year), "solMonth": f"{month:02d}",
                "_type": "json", "numOfRows": 50,
            })
        res.raise_for_status()
        out: dict[date, str] = {}
        for it in _items(res.json()):
            if str(it.get("isHoliday", "Y")) != "Y":
                continue
            s = str(it.get("locdate", ""))
            if len(s) == 8:
                out[date(int(s[:4]), int(s[4:6]), int(s[6:]))] = it.get("dateName") or "공휴일"
        _holiday_cache[k] = out
        return out
    except Exception as e:
        logger.warning("특일 정보 조회 실패(%s-%s): %s", year, month, e)
        return {}


async def holiday_name(service_key: Optional[str], d: date) -> Optional[str]:
    """주말·공휴일이면 이름, 영업일이면 None."""
    hol = await get_holidays(service_key, d.year, d.month)
    if d in hol:
        return hol[d]
    if d.weekday() >= 5:
        return "토요일" if d.weekday() == 5 else "일요일"
    return None


async def is_business_day(service_key: Optional[str], d: date) -> bool:
    return await holiday_name(service_key, d) is None


async def first_business_day(service_key: Optional[str], year: int, month: int) -> date:
    """그 달의 첫 영업일(월간 브리핑 발송일)."""
    d = date(year, month, 1)
    for _ in range(15):
        if await is_business_day(service_key, d):
            return d
        d += timedelta(days=1)
    return date(year, month, 1)


def summarize_forecast(items: list[dict], day: date) -> dict:
    """단기예보 항목 → 하루 요약(순수 함수). {tmin,tmax,sky_am,sky_pm,pop,text}."""
    ds = day.strftime("%Y%m%d")
    today = [i for i in items if str(i.get("fcstDate")) == ds]
    tmps, pops = [], []
    tmn = tmx = None
    by_time: dict[str, dict[str, str]] = {}
    for i in today:
        cat, val, t = i.get("category"), str(i.get("fcstValue")), str(i.get("fcstTime"))
        by_time.setdefault(t, {})[cat] = val
        try:
            if cat == "TMP":
                tmps.append(float(val))
            elif cat == "POP":
                pops.append(int(val))
            elif cat == "TMN":
                tmn = float(val)
            elif cat == "TMX":
                tmx = float(val)
        except ValueError:
            continue
    tmin = tmn if tmn is not None else (min(tmps) if tmps else None)
    tmax = tmx if tmx is not None else (max(tmps) if tmps else None)

    def sky_at(hhmm: str) -> Optional[str]:
        v = by_time.get(hhmm) or {}
        if v.get("PTY") and v["PTY"] != "0":
            return PTY.get(v["PTY"], "강수")
        return SKY.get(v.get("SKY", ""), None)

    am, pm = sky_at("0900"), sky_at("1500")
    pop = max(pops) if pops else None
    parts = []
    if am or pm:
        parts.append(am if am == pm or not pm else f"오전 {am or '-'} / 오후 {pm}")
    if tmin is not None and tmax is not None:
        parts.append(f"{tmin:.0f}~{tmax:.0f}℃")
    if pop is not None:
        parts.append(f"강수확률 {pop}%")
    return {"tmin": tmin, "tmax": tmax, "sky_am": am, "sky_pm": pm, "pop": pop, "text": ", ".join(parts)}


async def get_weather(service_key: Optional[str], day: date, region: str = "서울") -> dict:
    """오늘 날씨 요약. 실패하면 available=False."""
    base = {"region": region, "available": False}
    if not service_key:
        return base
    nx, ny = REGIONS.get(region, REGIONS["서울"])
    # 02시 발표에 오늘 최저·최고기온(TMN·TMX)이 들어 있다(02:10 이후 제공)
    base_date = day.strftime("%Y%m%d")
    try:
        async with httpx.AsyncClient(timeout=12) as client:
            res = await client.get(FORECAST_URL, params={
                "serviceKey": service_key, "dataType": "JSON", "numOfRows": 1000, "pageNo": 1,
                "base_date": base_date, "base_time": "0200", "nx": nx, "ny": ny,
            })
        res.raise_for_status()
        s = summarize_forecast(_items(res.json()), day)
        return {**base, "available": bool(s["text"]), **s}
    except Exception as e:
        logger.warning("기상청 단기예보 조회 실패: %s", e)
        return base
