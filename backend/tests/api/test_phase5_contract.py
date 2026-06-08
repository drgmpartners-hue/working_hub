"""Phase 5 Interface Contract Tests.

6개 신규 엔드포인트에 대해 200 반환 + spec 필수 필드 존재를 한 번에 검증.

Endpoints:
  GET /api/v1/market/stocks/{code}/signals
  GET /api/v1/market/stocks/{code}/backtest?period=1y
  GET /api/v1/stocks/screening          (+ pbr_max/ma_alignment/score_min 필터)
  GET /api/v1/stocks/performance        (+ theme/status 필터)
  GET /api/v1/stocks/performance/summary
"""
from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.deps import get_current_user
from app.models.user import User


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _mock_user() -> User:
    user = MagicMock(spec=User)
    user.id = "contract-user-001"
    user.is_active = True
    return user


def _make_market_app() -> FastAPI:
    from app.api.v1.market import router as market_router
    app = FastAPI()
    app.dependency_overrides[get_current_user] = lambda: _mock_user()
    app.include_router(market_router, prefix="/api/v1")
    return app


def _make_stock_app() -> FastAPI:
    from app.api.v1.stock import router as stock_router
    app = FastAPI()
    app.dependency_overrides[get_current_user] = lambda: _mock_user()
    app.include_router(stock_router, prefix="/api/v1")
    return app


# ---------------------------------------------------------------------------
# Contract: GET /api/v1/market/stocks/{code}/signals
# ---------------------------------------------------------------------------

class TestContractSignals:
    """P5-R3 signals 계약 검증."""

    def test_status_200(self):
        with TestClient(_make_market_app()) as c:
            resp = c.get("/api/v1/market/stocks/005930/signals")
        assert resp.status_code == 200

    def test_required_top_level_fields(self):
        """signals, composite_score, score_breakdown, roe, ma5/20/60/120 존재."""
        with TestClient(_make_market_app()) as c:
            body = c.get("/api/v1/market/stocks/005930/signals").json()

        required = ("signals", "composite_score", "score_breakdown", "roe",
                    "ma5", "ma20", "ma60", "ma120")
        for field in required:
            assert field in body, f"[signals] missing field: {field}"

    def test_signals_subfields(self):
        with TestClient(_make_market_app()) as c:
            signals = c.get("/api/v1/market/stocks/005930/signals").json()["signals"]

        for sub in ("golden_cross", "dead_cross", "ma_alignment", "disparity"):
            assert sub in signals, f"[signals.signals] missing: {sub}"
        assert signals["ma_alignment"] in ("bullish", "bearish", "mixed")

    def test_composite_score_range(self):
        with TestClient(_make_market_app()) as c:
            score = c.get("/api/v1/market/stocks/005930/signals").json()["composite_score"]
        assert 0 <= score <= 100

    def test_score_breakdown_subfields(self):
        with TestClient(_make_market_app()) as c:
            sb = c.get("/api/v1/market/stocks/005930/signals").json()["score_breakdown"]
        for sub in ("valuation", "momentum", "supply"):
            assert sub in sb, f"[score_breakdown] missing: {sub}"

    def test_ma_fields_numeric(self):
        with TestClient(_make_market_app()) as c:
            body = c.get("/api/v1/market/stocks/005930/signals").json()
        for ma in ("ma5", "ma20", "ma60", "ma120"):
            assert isinstance(body[ma], (int, float)), f"{ma} should be numeric"


# ---------------------------------------------------------------------------
# Contract: GET /api/v1/market/stocks/{code}/backtest?period=1y
# ---------------------------------------------------------------------------

class TestContractBacktest:
    """P5-R5 backtest 계약 검증."""

    def test_status_200(self):
        with TestClient(_make_market_app()) as c:
            resp = c.get("/api/v1/market/stocks/005930/backtest?period=1y")
        assert resp.status_code == 200

    def test_required_fields(self):
        """return_rate, benchmark_return, max_drawdown, chart_data 존재."""
        with TestClient(_make_market_app()) as c:
            body = c.get("/api/v1/market/stocks/005930/backtest?period=1y").json()

        required = ("return_rate", "benchmark_return", "max_drawdown", "chart_data",
                    "stock_code", "period")
        for field in required:
            assert field in body, f"[backtest] missing field: {field}"

    def test_chart_data_structure(self):
        with TestClient(_make_market_app()) as c:
            chart = c.get("/api/v1/market/stocks/005930/backtest?period=1y").json()["chart_data"]
        assert isinstance(chart, list) and len(chart) > 0
        for point in chart:
            assert "date" in point and "value" in point and "benchmark" in point

    def test_period_echoed(self):
        with TestClient(_make_market_app()) as c:
            body = c.get("/api/v1/market/stocks/005930/backtest?period=1y").json()
        assert body["period"] == "1y"


# ---------------------------------------------------------------------------
# Contract: GET /api/v1/stocks/screening
# ---------------------------------------------------------------------------

class TestContractScreening:
    """P5-R4 screening 계약 검증."""

    def test_status_200(self):
        with TestClient(_make_stock_app()) as c:
            resp = c.get("/api/v1/stocks/screening")
        assert resp.status_code == 200

    def test_returns_list_with_required_fields(self):
        with TestClient(_make_stock_app()) as c:
            body = c.get("/api/v1/stocks/screening").json()
        assert isinstance(body, list) and len(body) > 0
        required = ("stock_code", "stock_name", "theme", "pbr", "per",
                    "composite_score", "signal_tags", "ma_alignment",
                    "return_1m", "return_3m", "return_6m", "is_top5", "allocation_pct")
        for item in body:
            for field in required:
                assert field in item, f"[screening] missing field: {field}"

    def test_filter_pbr_max(self):
        with TestClient(_make_stock_app()) as c:
            body = c.get("/api/v1/stocks/screening?pbr_max=1.5").json()
        for item in body:
            assert item["pbr"] <= 1.5, f"pbr_max filter failed: {item['pbr']}"

    def test_filter_ma_alignment(self):
        with TestClient(_make_stock_app()) as c:
            body = c.get("/api/v1/stocks/screening?ma_alignment=bullish").json()
        for item in body:
            assert item["ma_alignment"] == "bullish"

    def test_filter_score_min(self):
        with TestClient(_make_stock_app()) as c:
            body = c.get("/api/v1/stocks/screening?score_min=60").json()
        for item in body:
            assert item["composite_score"] >= 60


# ---------------------------------------------------------------------------
# Contract: GET /api/v1/stocks/performance
# ---------------------------------------------------------------------------

class TestContractPerformance:
    """P5-R6 performance list 계약 검증."""

    def test_status_200(self):
        with TestClient(_make_stock_app()) as c:
            resp = c.get("/api/v1/stocks/performance")
        assert resp.status_code == 200

    def test_returns_list_with_required_fields(self):
        with TestClient(_make_stock_app()) as c:
            body = c.get("/api/v1/stocks/performance").json()
        assert isinstance(body, list) and len(body) > 0
        required = ("recommendation_id", "stock_code", "stock_name", "theme",
                    "recommended_date", "recommended_price", "current_price",
                    "return_since", "benchmark_return", "excess_return",
                    "holding_days", "status", "composite_score_at_rec")
        for item in body:
            for field in required:
                assert field in item, f"[performance] missing field: {field}"

    def test_filter_theme(self):
        with TestClient(_make_stock_app()) as c:
            body = c.get("/api/v1/stocks/performance?theme=반도체").json()
        for item in body:
            assert item["theme"] == "반도체"

    def test_filter_status(self):
        with TestClient(_make_stock_app()) as c:
            body = c.get("/api/v1/stocks/performance?status=hit").json()
        for item in body:
            assert item["status"] == "hit"


# ---------------------------------------------------------------------------
# Contract: GET /api/v1/stocks/performance/summary
# ---------------------------------------------------------------------------

class TestContractPerformanceSummary:
    """P5-R6 performance summary 계약 검증."""

    def test_status_200(self):
        with TestClient(_make_stock_app()) as c:
            resp = c.get("/api/v1/stocks/performance/summary")
        assert resp.status_code == 200

    def test_required_fields(self):
        """hit_rate, avg_excess_return, tracked_count, status_distribution 존재."""
        with TestClient(_make_stock_app()) as c:
            body = c.get("/api/v1/stocks/performance/summary").json()
        required = ("hit_rate", "avg_excess_return", "tracked_count", "status_distribution")
        for field in required:
            assert field in body, f"[summary] missing field: {field}"

    def test_status_distribution_keys(self):
        with TestClient(_make_stock_app()) as c:
            dist = c.get("/api/v1/stocks/performance/summary").json()["status_distribution"]
        for key in ("hit", "miss", "holding"):
            assert key in dist, f"[summary.status_distribution] missing: {key}"

    def test_hit_rate_valid_range(self):
        with TestClient(_make_stock_app()) as c:
            hit_rate = c.get("/api/v1/stocks/performance/summary").json()["hit_rate"]
        assert 0.0 <= hit_rate <= 1.0

    def test_tracked_count_positive(self):
        with TestClient(_make_stock_app()) as c:
            count = c.get("/api/v1/stocks/performance/summary").json()["tracked_count"]
        assert count > 0
