"""전일 증시 지수(데일리 브리핑 ① 기본 정보).

미국: S&P500(^GSPC)·나스닥(^IXIC)·다우존스(^DJI) / 한국: 코스피(^KS11)·코스닥(^KQ11)
금: 국제 금 선물(GC=F, 달러/온스) / 환율: 원/달러(KRW=X)
각 지수의 '브리핑 날짜 이전 마지막 거래일' 시가·종가·전일 대비 변동·등락률.
출처: yfinance(무료, 키 불필요). 실패한 지수는 available=False로 두고 브리핑은 계속한다.
휴장일은 자연히 처리된다(해당 날짜 행이 없으면 그 전 거래일을 쓴다).
"""
from __future__ import annotations

import asyncio
import logging
from datetime import date
from typing import Optional

logger = logging.getLogger(__name__)

INDICES = [
    {"key": "sp500", "name": "S&P500", "symbol": "^GSPC", "market": "US"},
    {"key": "nasdaq", "name": "나스닥", "symbol": "^IXIC", "market": "US"},
    {"key": "dow", "name": "다우존스", "symbol": "^DJI", "market": "US"},
    {"key": "kospi", "name": "코스피", "symbol": "^KS11", "market": "KR", "kis": "0001"},
    {"key": "kosdaq", "name": "코스닥", "symbol": "^KQ11", "market": "KR", "kis": "1001"},
    {"key": "gold", "name": "금", "symbol": "GC=F", "market": "CMD", "unit": "$"},        # 국제 금 선물(COMEX, 달러/온스)
    {"key": "usdkrw", "name": "원/달러", "symbol": "KRW=X", "market": "FX", "unit": "원"},  # 원·달러 환율
]


def pick_previous(rows: list[dict], before: date) -> Optional[dict]:
    """rows: [{date, open, close}] 오름차순. before 이전 마지막 거래일과 그 전날 종가로 변동 계산(순수 함수)."""
    past = [r for r in rows if r["date"] < before and r.get("close") is not None]
    if not past:
        return None
    last = past[-1]
    prev_close = past[-2]["close"] if len(past) >= 2 else None
    change = round(last["close"] - prev_close, 2) if prev_close else None
    pct = round(change / prev_close * 100, 2) if prev_close and change is not None else None
    return {
        "trade_date": last["date"].isoformat(),
        "open": round(last["open"], 2) if last.get("open") is not None else None,
        "close": round(last["close"], 2),
        "change": change,
        "change_pct": pct,
    }


def _history(symbol: str) -> list[dict]:
    import yfinance as yf

    df = yf.Ticker(symbol).history(period="15d", interval="1d", auto_adjust=False)
    out = []
    for idx, row in df.iterrows():
        try:
            out.append({"date": idx.date(), "open": float(row["Open"]), "close": float(row["Close"])})
        except (TypeError, ValueError):
            continue
    return out


async def _kis_rows(kis_creds: tuple[str, str], index_code: str) -> list[dict]:
    """KIS 지수 일봉(한국 지수 보조 출처)."""
    from datetime import datetime

    from app.services.collectors.kis_client import KISClient

    rows = await KISClient(*kis_creds).get_index_closes(index_code, min_rows=10)
    out = []
    for r in rows:
        try:
            out.append({"date": datetime.strptime(r["date"], "%Y%m%d").date(),
                        "open": r.get("open") or None, "close": float(r["close"])})
        except (KeyError, TypeError, ValueError):
            continue
    return out


async def previous_day_indices(briefing_date: date, kis_creds: Optional[tuple[str, str]] = None) -> list[dict]:
    """브리핑용 지수 5개 + 금·원달러 환율. 반환: [{key,name,market,available,source,trade_date,open,close,change,change_pct}].
    한국 지수는 yfinance가 실패하면 KIS(키가 있을 때)로 다시 시도한다."""

    async def one(ix: dict) -> dict:
        base = {"key": ix["key"], "name": ix["name"], "market": ix["market"], "available": False, "unit": ix.get("unit", "")}
        for attempt in range(2):
            try:
                rows = await asyncio.wait_for(asyncio.to_thread(_history, ix["symbol"]), timeout=20)
                picked = pick_previous(rows, briefing_date)
                if picked:
                    return {**base, "available": True, "source": "yahoo", **picked}
                break
            except Exception as e:  # 네트워크·파싱 오류
                logger.info("지수 조회 실패 %s (%s회): %s", ix["symbol"], attempt + 1, e)
                await asyncio.sleep(1.5)
        if ix.get("kis") and kis_creds:
            try:
                picked = pick_previous(await _kis_rows(kis_creds, ix["kis"]), briefing_date)
                if picked:
                    return {**base, "available": True, "source": "kis", **picked}
            except Exception as e:
                logger.info("KIS 지수 조회 실패 %s: %s", ix["kis"], e)
        return base

    return list(await asyncio.gather(*(one(ix) for ix in INDICES)))
