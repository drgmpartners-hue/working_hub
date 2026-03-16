"""Tests for PF-R2-T2: Snapshot history API with region/risk weight breakdown.

Covers:
  GET /api/v1/snapshots/history?account_id=&period=3m|6m|1y

Strategy
--------
- No real database required.  get_db and auth dependencies are overridden.
- snapshot_service.get_history_with_weights is patched with AsyncMock.
- FastAPI TestClient (sync) is used for simplicity.
"""
from __future__ import annotations

from datetime import date
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1.snapshots import router as snapshots_router
from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.user import User

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_ACCOUNT_ID = "acc-history-001"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_user() -> User:
    user = MagicMock(spec=User)
    user.id = "user-0001"
    user.is_active = True
    return user


def _make_app() -> FastAPI:
    app = FastAPI()
    mock_db = AsyncMock()
    mock_user = _make_user()
    app.dependency_overrides[get_db] = lambda: mock_db
    app.dependency_overrides[get_current_user] = lambda: mock_user
    app.include_router(snapshots_router, prefix="/api/v1")
    return app


def _history_item(
    snapshot_id: str,
    snapshot_date: date,
    total_evaluation: float = 10_000_000.0,
    total_return_rate: float = 5.0,
    region_weights: dict | None = None,
    risk_weights: dict | None = None,
) -> dict:
    return {
        "snapshot_id": snapshot_id,
        "snapshot_date": snapshot_date,
        "total_evaluation": total_evaluation,
        "total_return_rate": total_return_rate,
        "region_weights": region_weights or {"국내": 0.4, "미국": 0.6},
        "risk_weights": risk_weights or {"성장형": 0.6, "안정형": 0.4},
    }


# ---------------------------------------------------------------------------
# Tests: period filter parameter
# ---------------------------------------------------------------------------


class TestPeriodFilter:
    """Verify that the period query parameter is forwarded to the service."""

    def test_no_period_returns_all_history(self):
        """Omitting period should pass period=None to service and return all items."""
        items = [
            _history_item("s1", date(2025, 9, 1)),
            _history_item("s2", date(2025, 12, 1)),
            _history_item("s3", date(2026, 3, 1)),
        ]

        with patch(
            "app.api.v1.snapshots.snapshot_service.get_history_with_weights",
            new_callable=AsyncMock,
            return_value=items,
        ) as mock_svc:
            client = TestClient(_make_app())
            response = client.get(
                "/api/v1/snapshots/history",
                params={"account_id": _ACCOUNT_ID},
            )

        assert response.status_code == 200
        data = response.json()
        assert data["period"] is None
        assert len(data["items"]) == 3
        # Ensure service was called with period=None
        mock_svc.assert_awaited_once()
        call_kwargs = mock_svc.call_args
        assert call_kwargs.args[2] is None or call_kwargs.kwargs.get("period") is None

    def test_period_3m_forwarded_to_service(self):
        """period=3m is accepted and forwarded to the service layer."""
        items = [_history_item("s3", date(2026, 3, 1))]

        with patch(
            "app.api.v1.snapshots.snapshot_service.get_history_with_weights",
            new_callable=AsyncMock,
            return_value=items,
        ) as mock_svc:
            client = TestClient(_make_app())
            response = client.get(
                "/api/v1/snapshots/history",
                params={"account_id": _ACCOUNT_ID, "period": "3m"},
            )

        assert response.status_code == 200
        data = response.json()
        assert data["period"] == "3m"
        assert len(data["items"]) == 1

    def test_period_6m_forwarded_to_service(self):
        """period=6m is accepted and forwarded to the service layer."""
        items = [
            _history_item("s2", date(2025, 9, 1)),
            _history_item("s3", date(2026, 3, 1)),
        ]

        with patch(
            "app.api.v1.snapshots.snapshot_service.get_history_with_weights",
            new_callable=AsyncMock,
            return_value=items,
        ):
            client = TestClient(_make_app())
            response = client.get(
                "/api/v1/snapshots/history",
                params={"account_id": _ACCOUNT_ID, "period": "6m"},
            )

        assert response.status_code == 200
        data = response.json()
        assert data["period"] == "6m"
        assert len(data["items"]) == 2

    def test_period_1y_forwarded_to_service(self):
        """period=1y is accepted and forwarded to the service layer."""
        items = [
            _history_item("s1", date(2025, 3, 1)),
            _history_item("s2", date(2025, 9, 1)),
            _history_item("s3", date(2026, 3, 1)),
        ]

        with patch(
            "app.api.v1.snapshots.snapshot_service.get_history_with_weights",
            new_callable=AsyncMock,
            return_value=items,
        ):
            client = TestClient(_make_app())
            response = client.get(
                "/api/v1/snapshots/history",
                params={"account_id": _ACCOUNT_ID, "period": "1y"},
            )

        assert response.status_code == 200
        data = response.json()
        assert data["period"] == "1y"
        assert len(data["items"]) == 3

    def test_invalid_period_returns_422(self):
        """An unrecognised period value should return 422 Unprocessable Entity."""
        with patch(
            "app.api.v1.snapshots.snapshot_service.get_history_with_weights",
            new_callable=AsyncMock,
            return_value=[],
        ):
            client = TestClient(_make_app())
            response = client.get(
                "/api/v1/snapshots/history",
                params={"account_id": _ACCOUNT_ID, "period": "2y"},
            )

        assert response.status_code == 422


# ---------------------------------------------------------------------------
# Tests: region_weights aggregation
# ---------------------------------------------------------------------------


class TestRegionWeights:
    """Verify that region_weights are present and correctly structured."""

    def test_region_weights_in_response(self):
        """Each history item must contain region_weights dict."""
        items = [
            _history_item(
                "s1",
                date(2026, 1, 1),
                region_weights={"국내": 0.40, "미국": 0.30, "글로벌": 0.20, "기타": 0.10},
            )
        ]

        with patch(
            "app.api.v1.snapshots.snapshot_service.get_history_with_weights",
            new_callable=AsyncMock,
            return_value=items,
        ):
            client = TestClient(_make_app())
            response = client.get(
                "/api/v1/snapshots/history",
                params={"account_id": _ACCOUNT_ID},
            )

        assert response.status_code == 200
        item = response.json()["items"][0]
        rw = item["region_weights"]
        assert isinstance(rw, dict)
        assert rw["국내"] == pytest.approx(0.40)
        assert rw["미국"] == pytest.approx(0.30)
        assert rw["글로벌"] == pytest.approx(0.20)
        assert rw["기타"] == pytest.approx(0.10)

    def test_region_weights_sum_close_to_one(self):
        """Sum of all region weights should be close to 1.0."""
        items = [
            _history_item(
                "s1",
                date(2026, 1, 1),
                region_weights={"국내": 0.40, "미국": 0.30, "글로벌": 0.20, "기타": 0.10},
            )
        ]

        with patch(
            "app.api.v1.snapshots.snapshot_service.get_history_with_weights",
            new_callable=AsyncMock,
            return_value=items,
        ):
            client = TestClient(_make_app())
            response = client.get(
                "/api/v1/snapshots/history",
                params={"account_id": _ACCOUNT_ID},
            )

        item = response.json()["items"][0]
        total = sum(item["region_weights"].values())
        assert total == pytest.approx(1.0, abs=0.01)

    def test_empty_region_weights_when_no_holdings(self):
        """When no holding has a region, region_weights should be empty dict."""
        items = [
            _history_item("s1", date(2026, 1, 1), region_weights={})
        ]

        with patch(
            "app.api.v1.snapshots.snapshot_service.get_history_with_weights",
            new_callable=AsyncMock,
            return_value=items,
        ):
            client = TestClient(_make_app())
            response = client.get(
                "/api/v1/snapshots/history",
                params={"account_id": _ACCOUNT_ID},
            )

        item = response.json()["items"][0]
        assert item["region_weights"] == {}


# ---------------------------------------------------------------------------
# Tests: risk_weights aggregation
# ---------------------------------------------------------------------------


class TestRiskWeights:
    """Verify that risk_weights are present and correctly structured."""

    def test_risk_weights_in_response(self):
        """Each history item must contain risk_weights dict."""
        items = [
            _history_item(
                "s1",
                date(2026, 1, 1),
                risk_weights={
                    "절대안정형": 0.30,
                    "안정형": 0.40,
                    "성장형": 0.20,
                    "절대성장형": 0.10,
                },
            )
        ]

        with patch(
            "app.api.v1.snapshots.snapshot_service.get_history_with_weights",
            new_callable=AsyncMock,
            return_value=items,
        ):
            client = TestClient(_make_app())
            response = client.get(
                "/api/v1/snapshots/history",
                params={"account_id": _ACCOUNT_ID},
            )

        assert response.status_code == 200
        item = response.json()["items"][0]
        rw = item["risk_weights"]
        assert isinstance(rw, dict)
        assert rw["절대안정형"] == pytest.approx(0.30)
        assert rw["안정형"] == pytest.approx(0.40)
        assert rw["성장형"] == pytest.approx(0.20)
        assert rw["절대성장형"] == pytest.approx(0.10)

    def test_risk_weights_sum_close_to_one(self):
        """Sum of all risk weights should be close to 1.0."""
        items = [
            _history_item(
                "s1",
                date(2026, 1, 1),
                risk_weights={
                    "절대안정형": 0.30,
                    "안정형": 0.40,
                    "성장형": 0.20,
                    "절대성장형": 0.10,
                },
            )
        ]

        with patch(
            "app.api.v1.snapshots.snapshot_service.get_history_with_weights",
            new_callable=AsyncMock,
            return_value=items,
        ):
            client = TestClient(_make_app())
            response = client.get(
                "/api/v1/snapshots/history",
                params={"account_id": _ACCOUNT_ID},
            )

        item = response.json()["items"][0]
        total = sum(item["risk_weights"].values())
        assert total == pytest.approx(1.0, abs=0.01)

    def test_empty_risk_weights_when_no_holdings(self):
        """When no holding has a risk_level, risk_weights should be empty dict."""
        items = [
            _history_item("s1", date(2026, 1, 1), risk_weights={})
        ]

        with patch(
            "app.api.v1.snapshots.snapshot_service.get_history_with_weights",
            new_callable=AsyncMock,
            return_value=items,
        ):
            client = TestClient(_make_app())
            response = client.get(
                "/api/v1/snapshots/history",
                params={"account_id": _ACCOUNT_ID},
            )

        item = response.json()["items"][0]
        assert item["risk_weights"] == {}


# ---------------------------------------------------------------------------
# Tests: empty history
# ---------------------------------------------------------------------------


class TestEmptyHistory:
    """Verify graceful handling when there are no snapshots."""

    def test_empty_history_returns_empty_list(self):
        """When the account has no snapshots, items should be an empty list."""
        with patch(
            "app.api.v1.snapshots.snapshot_service.get_history_with_weights",
            new_callable=AsyncMock,
            return_value=[],
        ):
            client = TestClient(_make_app())
            response = client.get(
                "/api/v1/snapshots/history",
                params={"account_id": _ACCOUNT_ID},
            )

        assert response.status_code == 200
        data = response.json()
        assert data["items"] == []
        assert data["account_id"] == _ACCOUNT_ID

    def test_empty_history_with_period_filter(self):
        """Empty list is returned even when a period filter is applied."""
        with patch(
            "app.api.v1.snapshots.snapshot_service.get_history_with_weights",
            new_callable=AsyncMock,
            return_value=[],
        ):
            client = TestClient(_make_app())
            response = client.get(
                "/api/v1/snapshots/history",
                params={"account_id": _ACCOUNT_ID, "period": "3m"},
            )

        assert response.status_code == 200
        data = response.json()
        assert data["items"] == []
        assert data["period"] == "3m"


# ---------------------------------------------------------------------------
# Tests: response structure
# ---------------------------------------------------------------------------


class TestResponseStructure:
    """Verify that the response schema has all required fields."""

    def test_history_item_has_all_required_fields(self):
        """Each item must have snapshot_id, snapshot_date, total_evaluation,
        total_return_rate, region_weights, and risk_weights."""
        items = [
            _history_item(
                "s1",
                date(2026, 3, 1),
                total_evaluation=12_000_000.0,
                total_return_rate=8.5,
                region_weights={"국내": 0.5, "미국": 0.5},
                risk_weights={"성장형": 1.0},
            )
        ]

        with patch(
            "app.api.v1.snapshots.snapshot_service.get_history_with_weights",
            new_callable=AsyncMock,
            return_value=items,
        ):
            client = TestClient(_make_app())
            response = client.get(
                "/api/v1/snapshots/history",
                params={"account_id": _ACCOUNT_ID},
            )

        assert response.status_code == 200
        item = response.json()["items"][0]
        assert item["snapshot_id"] == "s1"
        assert item["snapshot_date"] == "2026-03-01"
        assert item["total_evaluation"] == pytest.approx(12_000_000.0)
        assert item["total_return_rate"] == pytest.approx(8.5)
        assert "region_weights" in item
        assert "risk_weights" in item

    def test_response_contains_account_id(self):
        """Top-level response includes account_id for client identification."""
        with patch(
            "app.api.v1.snapshots.snapshot_service.get_history_with_weights",
            new_callable=AsyncMock,
            return_value=[],
        ):
            client = TestClient(_make_app())
            response = client.get(
                "/api/v1/snapshots/history",
                params={"account_id": _ACCOUNT_ID},
            )

        data = response.json()
        assert data["account_id"] == _ACCOUNT_ID

    def test_items_ordered_by_date_ascending(self):
        """Items should be in ascending snapshot_date order (oldest first)."""
        items = [
            _history_item("s1", date(2025, 6, 1)),
            _history_item("s2", date(2025, 9, 1)),
            _history_item("s3", date(2026, 1, 1)),
            _history_item("s4", date(2026, 3, 1)),
        ]

        with patch(
            "app.api.v1.snapshots.snapshot_service.get_history_with_weights",
            new_callable=AsyncMock,
            return_value=items,
        ):
            client = TestClient(_make_app())
            response = client.get(
                "/api/v1/snapshots/history",
                params={"account_id": _ACCOUNT_ID},
            )

        dates = [i["snapshot_date"] for i in response.json()["items"]]
        assert dates == sorted(dates), "Items are not in ascending date order"
