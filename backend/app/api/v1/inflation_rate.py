"""ECOS (한국은행 경제통계시스템) 소비자물가상승률 proxy API."""
import os
import httpx
from datetime import datetime
from fastapi import APIRouter

router = APIRouter(prefix="/retirement", tags=["retirement"])

# 한국은행 ECOS API
ECOS_API_KEY = os.getenv("ECOS_API_KEY", "sample")
ECOS_BASE_URL = "https://ecos.bok.or.kr/api/StatisticSearch"
STAT_CODE = "901Y009"  # 소비자물가지수 (2020=100)
ITEM_CODE = "0"  # 총지수

# 캐시 (서버 재시작 전까지 유지)
_cache: dict[str, object] = {}


@router.get("/inflation-rate")
async def get_inflation_rate():
    """최근 연간 소비자물가상승률(전년대비)을 반환합니다.

    한국은행 ECOS API에서 지수를 가져와 전년대비 상승률을 직접 계산합니다.
    """
    today = datetime.now().strftime("%Y-%m-%d")
    if _cache.get("date") == today and "rate" in _cache:
        return {"rate": _cache["rate"], "year": _cache.get("year"), "source": "ecos_cached"}

    current_year = datetime.now().year
    start_year = current_year - 2  # 전년대비 계산을 위해 2년치
    url = (
        f"{ECOS_BASE_URL}/{ECOS_API_KEY}/json/kr/1/10/"
        f"{STAT_CODE}/A/{start_year}/{current_year}/{ITEM_CODE}"
    )

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()

        rows = data.get("StatisticSearch", {}).get("row", [])
        if len(rows) >= 2:
            # 마지막 두 연도로 전년대비 상승률 계산
            prev_val = float(rows[-2]["DATA_VALUE"])
            curr_val = float(rows[-1]["DATA_VALUE"])
            rate = round((curr_val - prev_val) / prev_val * 100, 1)
            year = rows[-1]["TIME"]
            _cache.update({"date": today, "rate": rate, "year": year})
            return {"rate": rate, "year": year, "source": "ecos"}
    except Exception:
        pass

    return {"rate": 2.5, "year": None, "source": "default"}
