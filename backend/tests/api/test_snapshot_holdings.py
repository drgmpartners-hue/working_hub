"""Tests for PF-R2-T1: Holding manual update and apply-master endpoints.

Covers:
  PUT  /api/v1/snapshots/{snapshot_id}/holdings/{holding_id}
  POST /api/v1/snapshots/{snapshot_id}/holdings/apply-master

Strategy
--------
- No real database required. get_db and auth dependencies are overridden with
  mocks. Service functions are patched with AsyncMock / MagicMock.
- FastAPI TestClient (sync) is used for simplicity (same pattern as
  test_portfolios.py).
"""
from __future__ import annotations

from datetime import date, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1.snapshots import router as snapshots_router
from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.snapshot import PortfolioHolding, PortfolioSnapshot
from app.models.user import User

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_SNAPSHOT_ID = "snap-0001"
_HOLDING_ID = "hold-0001"
_ACCOUNT_ID = "acc-0001"


def _make_user() -> User:
    user = MagicMock(spec=User)
    user.id = "user-0001"
    user.is_active = True
    return user


def _make_holding(
    holding_id: str = _HOLDING_ID,
    snapshot_id: str = _SNAPSHOT_ID,
    product_name: str = "TIGER 미국S&P500",
    risk_level: str = "성장형",
    region: str = "미국",
) -> PortfolioHolding:
    h = MagicMock(spec=PortfolioHolding)
    h.id = holding_id
    h.snapshot_id = snapshot_id
    h.product_name = product_name
    h.product_code = None
    h.product_type = "ETF"
    h.risk_level = risk_level
    h.region = region
    h.purchase_amount = 1_000_000.0
    h.evaluation_amount = 1_100_000.0
    h.return_amount = 100_000.0
    h.return_rate = 10.0
    h.weight = 25.0
    h.reference_price = None
    h.seq = 1
    return h


def _make_snapshot(snapshot_id: str = _SNAPSHOT_ID) -> PortfolioSnapshot:
    s = MagicMock(spec=PortfolioSnapshot)
    s.id = snapshot_id
    s.client_account_id = _ACCOUNT_ID
    s.snapshot_date = date(2026, 3, 1)
    s.image_path = None
    s.parsed_data = None
    s.deposit_amount = None
    s.total_purchase = 4_000_000.0
    s.total_evaluation = 4_400_000.0
    s.total_return = 400_000.0
    s.total_return_rate = 10.0
    s.created_at = datetime(2026, 3, 1, 12, 0, 0)
    s.holdings = [_make_holding()]
    return s


def _make_app() -> FastAPI:
    app = FastAPI()
    mock_db = AsyncMock()
    mock_user = _make_user()
    app.dependency_overrides[get_db] = lambda: mock_db
    app.dependency_overrides[get_current_user] = lambda: mock_user
    app.include_router(snapshots_router, prefix="/api/v1")
    return app


# ---------------------------------------------------------------------------
# Tests: PUT /api/v1/snapshots/{snapshot_id}/holdings/{holding_id}
# ---------------------------------------------------------------------------


class TestUpdateHolding:
    """PUT /api/v1/snapshots/{snapshot_id}/holdings/{holding_id}"""

    def test_update_risk_and_region_returns_200(self):
        """Updating risk_level and region on an existing holding returns 200
        with the updated values."""
        updated_holding = _make_holding(risk_level="절대성장형", region="글로벌")

        with patch(
            "app.api.v1.snapshots.snapshot_service.update_holding",
            new_callable=AsyncMock,
            return_value=updated_holding,
        ):
            client = TestClient(_make_app())
            response = client.put(
                f"/api/v1/snapshots/{_SNAPSHOT_ID}/holdings/{_HOLDING_ID}",
                json={"risk_level": "절대성장형", "region": "글로벌"},
            )

        assert response.status_code == 200
        data = response.json()
        assert data["id"] == _HOLDING_ID
        assert data["risk_level"] == "절대성장형"
        assert data["region"] == "글로벌"

    def test_update_amounts(self):
        """purchase_amount, evaluation_amount, return_rate can be patched."""
        updated_holding = _make_holding()
        updated_holding.purchase_amount = 2_000_000.0
        updated_holding.evaluation_amount = 2_200_000.0
        updated_holding.return_rate = 10.0

        with patch(
            "app.api.v1.snapshots.snapshot_service.update_holding",
            new_callable=AsyncMock,
            return_value=updated_holding,
        ):
            client = TestClient(_make_app())
            response = client.put(
                f"/api/v1/snapshots/{_SNAPSHOT_ID}/holdings/{_HOLDING_ID}",
                json={
                    "purchase_amount": 2_000_000.0,
                    "evaluation_amount": 2_200_000.0,
                    "return_rate": 10.0,
                },
            )

        assert response.status_code == 200
        data = response.json()
        assert data["purchase_amount"] == 2_000_000.0
        assert data["evaluation_amount"] == 2_200_000.0

    def test_returns_404_when_holding_not_found(self):
        """Returns 404 when the holding does not exist or is not in the snapshot."""
        with patch(
            "app.api.v1.snapshots.snapshot_service.update_holding",
            new_callable=AsyncMock,
            return_value=None,
        ):
            client = TestClient(_make_app())
            response = client.put(
                f"/api/v1/snapshots/{_SNAPSHOT_ID}/holdings/nonexistent-id",
                json={"risk_level": "성장형"},
            )

        assert response.status_code == 404
        assert "not found" in response.json()["detail"].lower()

    def test_empty_body_accepted(self):
        """An empty update body (no fields) is valid — returns existing holding."""
        existing = _make_holding()

        with patch(
            "app.api.v1.snapshots.snapshot_service.update_holding",
            new_callable=AsyncMock,
            return_value=existing,
        ):
            client = TestClient(_make_app())
            response = client.put(
                f"/api/v1/snapshots/{_SNAPSHOT_ID}/holdings/{_HOLDING_ID}",
                json={},
            )

        assert response.status_code == 200

    def test_requires_authentication(self):
        """Without auth the endpoint should be protected (dependency raises)."""
        app = FastAPI()
        mock_db = AsyncMock()
        app.dependency_overrides[get_db] = lambda: mock_db
        # Do NOT override get_current_user — let it use the real dependency
        app.include_router(snapshots_router, prefix="/api/v1")

        with patch(
            "app.api.v1.snapshots.snapshot_service.update_holding",
            new_callable=AsyncMock,
            return_value=None,
        ):
            client = TestClient(app, raise_server_exceptions=False)
            response = client.put(
                f"/api/v1/snapshots/{_SNAPSHOT_ID}/holdings/{_HOLDING_ID}",
                json={"risk_level": "성장형"},
            )

        # Without a valid token the dependency raises 401 or 422
        assert response.status_code in (401, 422)


# ---------------------------------------------------------------------------
# Tests: POST /api/v1/snapshots/{snapshot_id}/holdings/apply-master
# ---------------------------------------------------------------------------


class TestApplyMaster:
    """POST /api/v1/snapshots/{snapshot_id}/holdings/apply-master"""

    def test_apply_master_returns_updated_count(self):
        """Returns updated count and empty not_found list when all holdings
        are matched in product_master."""
        snapshot = _make_snapshot()

        with (
            patch(
                "app.api.v1.snapshots.snapshot_service.get_snapshot_with_holdings",
                new_callable=AsyncMock,
                return_value=snapshot,
            ),
            patch(
                "app.api.v1.snapshots.snapshot_service.apply_master_to_snapshot",
                new_callable=AsyncMock,
                return_value={"updated": 1, "not_found": []},
            ),
        ):
            client = TestClient(_make_app())
            response = client.post(
                f"/api/v1/snapshots/{_SNAPSHOT_ID}/holdings/apply-master"
            )

        assert response.status_code == 200
        data = response.json()
        assert data["updated"] == 1
        assert data["not_found"] == []

    def test_apply_master_returns_not_found_list(self):
        """not_found contains product names not in product_master."""
        snapshot = _make_snapshot()

        with (
            patch(
                "app.api.v1.snapshots.snapshot_service.get_snapshot_with_holdings",
                new_callable=AsyncMock,
                return_value=snapshot,
            ),
            patch(
                "app.api.v1.snapshots.snapshot_service.apply_master_to_snapshot",
                new_callable=AsyncMock,
                return_value={"updated": 0, "not_found": ["미등록상품A", "미등록상품B"]},
            ),
        ):
            client = TestClient(_make_app())
            response = client.post(
                f"/api/v1/snapshots/{_SNAPSHOT_ID}/holdings/apply-master"
            )

        assert response.status_code == 200
        data = response.json()
        assert data["updated"] == 0
        assert "미등록상품A" in data["not_found"]

    def test_returns_404_when_snapshot_not_found(self):
        """Returns 404 when the snapshot does not exist."""
        with patch(
            "app.api.v1.snapshots.snapshot_service.get_snapshot_with_holdings",
            new_callable=AsyncMock,
            return_value=None,
        ):
            client = TestClient(_make_app())
            response = client.post(
                "/api/v1/snapshots/nonexistent-snap/holdings/apply-master"
            )

        assert response.status_code == 404

    def test_returns_503_when_product_master_unavailable(self):
        """Returns 503 when the product_master table is not yet migrated."""
        snapshot = _make_snapshot()

        with (
            patch(
                "app.api.v1.snapshots.snapshot_service.get_snapshot_with_holdings",
                new_callable=AsyncMock,
                return_value=snapshot,
            ),
            patch(
                "app.api.v1.snapshots.snapshot_service.apply_master_to_snapshot",
                new_callable=AsyncMock,
                side_effect=ImportError("product_master model is not yet available."),
            ),
        ):
            client = TestClient(_make_app())
            response = client.post(
                f"/api/v1/snapshots/{_SNAPSHOT_ID}/holdings/apply-master"
            )

        assert response.status_code == 503
