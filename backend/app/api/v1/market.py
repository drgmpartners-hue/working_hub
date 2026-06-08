"""Market-level stock endpoints — Phase 5 (P5-R3, P5-R5).

GET /api/v1/market/stocks/{code}/signals
GET /api/v1/market/stocks/{code}/backtest
"""
from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.db.session import get_db
from app.schemas.stock import BacktestResponse, MarketSignalsResponse
from app.services import market_data_service

router = APIRouter(prefix="/market", tags=["market"])

_VALID_PERIODS = Literal["1m", "3m", "6m", "1y", "3y"]


# ---------------------------------------------------------------------------
# P5-R3: Signals & Composite Score
# ---------------------------------------------------------------------------

@router.get(
    "/stocks/{code}/signals",
    response_model=MarketSignalsResponse,
    summary="[P5-R3] 종목 시그널·종합점수 (KIS 실데이터 / 키 없으면 mock)",
)
async def get_stock_signals(
    code: str,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> MarketSignalsResponse:
    """
    종목 이동평균(5/20/60/120)·골든/데드크로스·정배열·종합점수·ROE 반환.
    사용자의 KIS 키가 있으면 실시세 기반, 없거나 실패 시 mock 폴백 (data_source로 구분).
    ⚠️ composite_score 가중치 로직은 사용자 자료로 확정 예정.
    """
    return await market_data_service.get_signals(db, current_user.id, code)


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
    db: Annotated[AsyncSession, Depends(get_db)],
    period: _VALID_PERIODS = Query(default="1y", description="백테스트 기간: 1m|3m|6m|1y|3y"),
) -> BacktestResponse:
    """
    KIS 실 OHLCV 기반 기간 수익률·KOSPI 대비·최대낙폭. 키 없거나 실패 시 mock 폴백.
    """
    return await market_data_service.get_backtest(db, current_user.id, code, period)
