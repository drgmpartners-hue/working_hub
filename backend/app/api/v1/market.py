"""Market-level stock endpoints — Phase 5 (P5-R3, P5-R5).

GET /api/v1/market/stocks/{code}/signals
GET /api/v1/market/stocks/{code}/backtest
"""
from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query

from app.core.deps import CurrentUser
from app.schemas.stock import BacktestResponse, MarketSignalsResponse
from app.services import stock_advanced_service

router = APIRouter(prefix="/market", tags=["market"])

_VALID_PERIODS = Literal["1m", "3m", "6m", "1y", "3y"]


# ---------------------------------------------------------------------------
# P5-R3: Signals & Composite Score
# ---------------------------------------------------------------------------

@router.get(
    "/stocks/{code}/signals",
    response_model=MarketSignalsResponse,
    summary="[P5-R3] 종목 시그널·종합점수 (mock)",
)
async def get_stock_signals(
    code: str,
    current_user: CurrentUser,
) -> MarketSignalsResponse:
    """
    종목 코드 기반 이동평균·골든크로스·종합점수·ROE를 반환.
    ⚠️ 산정 로직 사용자 자료 대기 — placeholder (결정적 hash-mock).
    """
    return stock_advanced_service.get_market_signals(code)


# ---------------------------------------------------------------------------
# P5-R5: Backtest
# ---------------------------------------------------------------------------

@router.get(
    "/stocks/{code}/backtest",
    response_model=BacktestResponse,
    summary="[P5-R5] 종목 백테스트 (mock)",
)
async def get_stock_backtest(
    code: str,
    current_user: CurrentUser,
    period: _VALID_PERIODS = Query(default="1y", description="백테스트 기간: 1m|3m|6m|1y|3y"),
) -> BacktestResponse:
    """
    지정 기간의 mock 백테스트 결과 반환.
    ⚠️ 산정 로직 사용자 자료 대기 — placeholder (결정적 hash-mock).
    """
    return stock_advanced_service.get_backtest(code, period)
