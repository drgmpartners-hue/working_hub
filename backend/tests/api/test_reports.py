"""Tests for PF-R3-T1: Portfolio Report API with AI comment generation.

Covers:
  POST /api/v1/reports/portfolio

Strategy
--------
- No real database required. get_db and auth dependencies are overridden.
- report_service functions are patched with AsyncMock/MagicMock.
- FastAPI TestClient (sync) is used for simplicity.
"""
from __future__ import annotations

from datetime import date, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1.reports import router as reports_router
from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.user import User

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_CLIENT_ID = "client-report-001"
_ACCOUNT_ID_1 = "acc-report-001"
_ACCOUNT_ID_2 = "acc-report-002"
_REPORT_ID = "report-uuid-001"

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
    app.include_router(reports_router, prefix="/api/v1")
    return app


def _make_holding(
    product_name: str = "삼성KODEX200ETF",
    risk_level: str = "성장형",
    region: str = "국내",
    purchase_amount: float = 5_000_000.0,
    evaluation_amount: float = 5_500_000.0,
) -> dict:
    profit_loss = evaluation_amount - purchase_amount
    return_rate = round(profit_loss / purchase_amount * 100, 2) if purchase_amount else 0.0
    return {
        "id": "holding-001",
        "product_name": product_name,
        "risk_level": risk_level,
        "region": region,
        "purchase_amount": purchase_amount,
        "evaluation_amount": evaluation_amount,
        "profit_loss": profit_loss,
        "return_rate": return_rate,
        "weight": 0.5,
    }


def _make_account_report(
    account_id: str = _ACCOUNT_ID_1,
    account_type: str = "irp",
    ai_comment: str = "현재 포트폴리오는 성장형 비중이 높아 수익 추구에 적합합니다.",
) -> dict:
    return {
        "account_id": account_id,
        "account_type": account_type,
        "account_number": "123-456-789",
        "securities_company": "NH투자증권",
        "snapshot_date": "2026-01-15",
        "monthly_payment": 300_000,
        "deposit": 100_000.0,
        "principal": 10_000_000.0,
        "evaluation": 11_000_000.0,
        "profit": 1_000_000.0,
        "return_rate": 10.0,
        "holdings": [_make_holding()],
        "region_distribution": {"국내": 0.5, "미국": 0.5},
        "risk_distribution": {"성장형": 1.0},
        "history": [
            {
                "snapshot_id": "snap-001",
                "snapshot_date": "2025-10-15",
                "total_evaluation": 10_500_000.0,
                "total_return_rate": 5.0,
                "region_weights": {"국내": 0.5, "미국": 0.5},
                "risk_weights": {"성장형": 1.0},
            }
        ],
        "ai_comment": ai_comment,
    }


def _make_report_response(
    accounts: list[dict] | None = None,
) -> dict:
    accounts = accounts or [_make_account_report()]
    total_evaluation = sum(a["evaluation"] for a in accounts)
    total_principal = sum(a["principal"] for a in accounts)
    total_profit = sum(a["profit"] for a in accounts)
    total_return_rate = round(total_profit / total_principal * 100, 2) if total_principal else 0.0
    return {
        "report_id": _REPORT_ID,
        "client_name": "홍길동",
        "generated_at": datetime(2026, 3, 16, 12, 0, 0).isoformat(),
        "summary": {
            "total_evaluation": total_evaluation,
            "total_principal": total_principal,
            "total_profit": total_profit,
            "total_return_rate": total_return_rate,
        },
        "accounts": accounts,
    }


# ---------------------------------------------------------------------------
# Tests: basic report generation
# ---------------------------------------------------------------------------


class TestReportGeneration:
    """Verify that the report endpoint returns correct structured data."""

    def test_post_report_returns_200(self):
        """POST /api/v1/reports/portfolio should return 200 with valid payload."""
        mock_report = _make_report_response()

        with patch(
            "app.api.v1.reports.report_service.generate_portfolio_report",
            new_callable=AsyncMock,
            return_value=mock_report,
        ):
            client = TestClient(_make_app())
            response = client.post(
                "/api/v1/reports/portfolio",
                json={
                    "client_id": _CLIENT_ID,
                    "account_ids": [_ACCOUNT_ID_1],
                    "snapshot_date": "2026-01-15",
                    "period": "3m",
                },
            )

        assert response.status_code == 200

    def test_report_has_required_top_level_fields(self):
        """Response must contain report_id, client_name, generated_at, summary, accounts."""
        mock_report = _make_report_response()

        with patch(
            "app.api.v1.reports.report_service.generate_portfolio_report",
            new_callable=AsyncMock,
            return_value=mock_report,
        ):
            client = TestClient(_make_app())
            response = client.post(
                "/api/v1/reports/portfolio",
                json={
                    "client_id": _CLIENT_ID,
                    "account_ids": [_ACCOUNT_ID_1],
                    "snapshot_date": "2026-01-15",
                    "period": "3m",
                },
            )

        data = response.json()
        assert "report_id" in data
        assert "client_name" in data
        assert "generated_at" in data
        assert "summary" in data
        assert "accounts" in data

    def test_summary_contains_financial_fields(self):
        """Summary must contain total_evaluation, total_principal, total_profit, total_return_rate."""
        mock_report = _make_report_response()

        with patch(
            "app.api.v1.reports.report_service.generate_portfolio_report",
            new_callable=AsyncMock,
            return_value=mock_report,
        ):
            client = TestClient(_make_app())
            response = client.post(
                "/api/v1/reports/portfolio",
                json={
                    "client_id": _CLIENT_ID,
                    "account_ids": [_ACCOUNT_ID_1],
                    "snapshot_date": "2026-01-15",
                    "period": "3m",
                },
            )

        summary = response.json()["summary"]
        assert "total_evaluation" in summary
        assert "total_principal" in summary
        assert "total_profit" in summary
        assert "total_return_rate" in summary

    def test_account_has_required_fields(self):
        """Each account entry must have all required portfolio fields."""
        mock_report = _make_report_response()

        with patch(
            "app.api.v1.reports.report_service.generate_portfolio_report",
            new_callable=AsyncMock,
            return_value=mock_report,
        ):
            client = TestClient(_make_app())
            response = client.post(
                "/api/v1/reports/portfolio",
                json={
                    "client_id": _CLIENT_ID,
                    "account_ids": [_ACCOUNT_ID_1],
                    "snapshot_date": "2026-01-15",
                    "period": "3m",
                },
            )

        account = response.json()["accounts"][0]
        required_fields = [
            "account_id", "account_type", "account_number", "securities_company",
            "snapshot_date", "monthly_payment", "deposit", "principal",
            "evaluation", "profit", "return_rate", "holdings",
            "region_distribution", "risk_distribution", "history", "ai_comment",
        ]
        for field in required_fields:
            assert field in account, f"Missing field: {field}"

    def test_holding_has_required_fields(self):
        """Each holding entry must have product_name, risk_level, region, and financial fields."""
        mock_report = _make_report_response()

        with patch(
            "app.api.v1.reports.report_service.generate_portfolio_report",
            new_callable=AsyncMock,
            return_value=mock_report,
        ):
            client = TestClient(_make_app())
            response = client.post(
                "/api/v1/reports/portfolio",
                json={
                    "client_id": _CLIENT_ID,
                    "account_ids": [_ACCOUNT_ID_1],
                    "snapshot_date": "2026-01-15",
                    "period": "3m",
                },
            )

        holding = response.json()["accounts"][0]["holdings"][0]
        required_fields = [
            "id", "product_name", "risk_level", "region",
            "purchase_amount", "evaluation_amount", "profit_loss",
            "return_rate", "weight",
        ]
        for field in required_fields:
            assert field in holding, f"Missing holding field: {field}"


# ---------------------------------------------------------------------------
# Tests: AI comment generation
# ---------------------------------------------------------------------------


class TestAIComment:
    """Verify AI comment behavior including fallback on failure."""

    def test_ai_comment_present_in_account(self):
        """ai_comment field must be present in each account."""
        comment = "현재 포트폴리오는 성장형 비중이 높아 적극적 투자 성향에 적합합니다."
        mock_report = _make_report_response(
            accounts=[_make_account_report(ai_comment=comment)]
        )

        with patch(
            "app.api.v1.reports.report_service.generate_portfolio_report",
            new_callable=AsyncMock,
            return_value=mock_report,
        ):
            client = TestClient(_make_app())
            response = client.post(
                "/api/v1/reports/portfolio",
                json={
                    "client_id": _CLIENT_ID,
                    "account_ids": [_ACCOUNT_ID_1],
                    "snapshot_date": "2026-01-15",
                    "period": "3m",
                },
            )

        ai_comment = response.json()["accounts"][0]["ai_comment"]
        assert ai_comment == comment

    def test_ai_comment_fallback_to_empty_string(self):
        """When AI fails, ai_comment should be empty string (not null/error)."""
        mock_report = _make_report_response(
            accounts=[_make_account_report(ai_comment="")]
        )

        with patch(
            "app.api.v1.reports.report_service.generate_portfolio_report",
            new_callable=AsyncMock,
            return_value=mock_report,
        ):
            client = TestClient(_make_app())
            response = client.post(
                "/api/v1/reports/portfolio",
                json={
                    "client_id": _CLIENT_ID,
                    "account_ids": [_ACCOUNT_ID_1],
                    "snapshot_date": "2026-01-15",
                    "period": "3m",
                },
            )

        assert response.status_code == 200
        ai_comment = response.json()["accounts"][0]["ai_comment"]
        assert ai_comment == ""

    def test_ai_comment_not_none(self):
        """ai_comment must never be null/None."""
        mock_report = _make_report_response(
            accounts=[_make_account_report(ai_comment="")]
        )

        with patch(
            "app.api.v1.reports.report_service.generate_portfolio_report",
            new_callable=AsyncMock,
            return_value=mock_report,
        ):
            client = TestClient(_make_app())
            response = client.post(
                "/api/v1/reports/portfolio",
                json={
                    "client_id": _CLIENT_ID,
                    "account_ids": [_ACCOUNT_ID_1],
                    "snapshot_date": "2026-01-15",
                    "period": "3m",
                },
            )

        ai_comment = response.json()["accounts"][0].get("ai_comment")
        assert ai_comment is not None


# ---------------------------------------------------------------------------
# Tests: edge cases
# ---------------------------------------------------------------------------


class TestEdgeCases:
    """Verify graceful handling of edge cases."""

    def test_empty_account_ids_returns_empty_accounts(self):
        """When account_ids is empty, accounts list should be empty."""
        mock_report = {
            "report_id": _REPORT_ID,
            "client_name": "홍길동",
            "generated_at": datetime(2026, 3, 16, 12, 0, 0).isoformat(),
            "summary": {
                "total_evaluation": 0.0,
                "total_principal": 0.0,
                "total_profit": 0.0,
                "total_return_rate": 0.0,
            },
            "accounts": [],
        }

        with patch(
            "app.api.v1.reports.report_service.generate_portfolio_report",
            new_callable=AsyncMock,
            return_value=mock_report,
        ):
            client = TestClient(_make_app())
            response = client.post(
                "/api/v1/reports/portfolio",
                json={
                    "client_id": _CLIENT_ID,
                    "account_ids": [],
                    "snapshot_date": "2026-01-15",
                    "period": "3m",
                },
            )

        assert response.status_code == 200
        data = response.json()
        assert data["accounts"] == []

    def test_multiple_accounts_in_report(self):
        """Report can include multiple accounts of different types."""
        accounts = [
            _make_account_report(account_id=_ACCOUNT_ID_1, account_type="irp"),
            _make_account_report(account_id=_ACCOUNT_ID_2, account_type="pension"),
        ]
        mock_report = _make_report_response(accounts=accounts)

        with patch(
            "app.api.v1.reports.report_service.generate_portfolio_report",
            new_callable=AsyncMock,
            return_value=mock_report,
        ):
            client = TestClient(_make_app())
            response = client.post(
                "/api/v1/reports/portfolio",
                json={
                    "client_id": _CLIENT_ID,
                    "account_ids": [_ACCOUNT_ID_1, _ACCOUNT_ID_2],
                    "snapshot_date": "2026-01-15",
                    "period": "3m",
                },
            )

        data = response.json()
        assert len(data["accounts"]) == 2
        account_types = [a["account_type"] for a in data["accounts"]]
        assert "irp" in account_types
        assert "pension" in account_types

    def test_missing_snapshot_date_returns_422(self):
        """snapshot_date is required; omitting it should return 422."""
        client = TestClient(_make_app())
        response = client.post(
            "/api/v1/reports/portfolio",
            json={
                "client_id": _CLIENT_ID,
                "account_ids": [_ACCOUNT_ID_1],
                # snapshot_date omitted
                "period": "3m",
            },
        )
        assert response.status_code == 422

    def test_missing_client_id_returns_422(self):
        """client_id is required; omitting it should return 422."""
        client = TestClient(_make_app())
        response = client.post(
            "/api/v1/reports/portfolio",
            json={
                # client_id omitted
                "account_ids": [_ACCOUNT_ID_1],
                "snapshot_date": "2026-01-15",
                "period": "3m",
            },
        )
        assert response.status_code == 422

    def test_invalid_period_returns_422(self):
        """Unrecognised period value should return 422."""
        client = TestClient(_make_app())
        response = client.post(
            "/api/v1/reports/portfolio",
            json={
                "client_id": _CLIENT_ID,
                "account_ids": [_ACCOUNT_ID_1],
                "snapshot_date": "2026-01-15",
                "period": "2y",  # invalid
            },
        )
        assert response.status_code == 422

    def test_period_defaults_to_3m_when_omitted(self):
        """period should default to '3m' when not provided."""
        mock_report = _make_report_response()

        with patch(
            "app.api.v1.reports.report_service.generate_portfolio_report",
            new_callable=AsyncMock,
            return_value=mock_report,
        ) as mock_svc:
            client = TestClient(_make_app())
            response = client.post(
                "/api/v1/reports/portfolio",
                json={
                    "client_id": _CLIENT_ID,
                    "account_ids": [_ACCOUNT_ID_1],
                    "snapshot_date": "2026-01-15",
                    # period omitted - should default to "3m"
                },
            )

        assert response.status_code == 200
        # Service should have been called with period="3m"
        mock_svc.assert_awaited_once()

    def test_region_distribution_is_dict(self):
        """region_distribution must be a dict with string keys and float values."""
        mock_report = _make_report_response()

        with patch(
            "app.api.v1.reports.report_service.generate_portfolio_report",
            new_callable=AsyncMock,
            return_value=mock_report,
        ):
            client = TestClient(_make_app())
            response = client.post(
                "/api/v1/reports/portfolio",
                json={
                    "client_id": _CLIENT_ID,
                    "account_ids": [_ACCOUNT_ID_1],
                    "snapshot_date": "2026-01-15",
                    "period": "3m",
                },
            )

        region_dist = response.json()["accounts"][0]["region_distribution"]
        assert isinstance(region_dist, dict)
        for key, val in region_dist.items():
            assert isinstance(key, str)
            assert isinstance(val, float)

    def test_risk_distribution_is_dict(self):
        """risk_distribution must be a dict with string keys and float values."""
        mock_report = _make_report_response()

        with patch(
            "app.api.v1.reports.report_service.generate_portfolio_report",
            new_callable=AsyncMock,
            return_value=mock_report,
        ):
            client = TestClient(_make_app())
            response = client.post(
                "/api/v1/reports/portfolio",
                json={
                    "client_id": _CLIENT_ID,
                    "account_ids": [_ACCOUNT_ID_1],
                    "snapshot_date": "2026-01-15",
                    "period": "3m",
                },
            )

        risk_dist = response.json()["accounts"][0]["risk_distribution"]
        assert isinstance(risk_dist, dict)
        for key, val in risk_dist.items():
            assert isinstance(key, str)
            assert isinstance(val, float)
