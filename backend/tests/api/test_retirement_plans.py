"""Tests for retirement plans API endpoints.

Covers:
  GET  /api/v1/retirement/plans/{customer_id}
  POST /api/v1/retirement/plans
  PUT  /api/v1/retirement/plans/{id}
  POST /api/v1/retirement/simulation/calculate

Strategy
--------
- No real database is required. The ``get_db`` FastAPI dependency is overridden
  to yield a ``MagicMock`` session, and DB calls are patched with ``AsyncMock``.
- ``httpx.AsyncClient`` with ``ASGITransport`` drives the ASGI app in-process.
"""
from __future__ import annotations

from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.retirement_plans import router
from app.core.deps import get_current_user
from app.db.session import get_db


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_test_app(mock_db: AsyncSession, mock_user) -> FastAPI:
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_db] = lambda: mock_db
    app.dependency_overrides[get_current_user] = lambda: mock_user
    return app


def make_mock_user():
    user = MagicMock()
    user.id = "user-uuid-001"
    user.is_active = True
    return user


def make_mock_plan(**kwargs):
    plan = MagicMock()
    plan.id = kwargs.get("id", 1)
    plan.profile_id = kwargs.get("profile_id", "profile-uuid-001")
    plan.current_age = kwargs.get("current_age", 45)
    plan.lump_sum_amount = kwargs.get("lump_sum_amount", 50000)
    plan.annual_savings = kwargs.get("annual_savings", 12000)
    plan.saving_period_years = kwargs.get("saving_period_years", 15)
    plan.inflation_rate = kwargs.get("inflation_rate", 2.0)
    plan.annual_return_rate = kwargs.get("annual_return_rate", 7.0)
    plan.target_retirement_fund = kwargs.get("target_retirement_fund", 500000)
    plan.target_pension_amount = kwargs.get("target_pension_amount", 3000)
    plan.desired_retirement_age = kwargs.get("desired_retirement_age", 60)
    plan.possible_retirement_age = kwargs.get("possible_retirement_age", 62)
    plan.inheritance_consideration = kwargs.get("inheritance_consideration", False)
    plan.yearly_projections = kwargs.get("yearly_projections", [])
    plan.created_at = kwargs.get("created_at", datetime(2025, 1, 1))
    plan.updated_at = kwargs.get("updated_at", datetime(2025, 1, 1))
    return plan


# ---------------------------------------------------------------------------
# GET /api/v1/retirement/plans/{customer_id}
# ---------------------------------------------------------------------------

class TestGetRetirementPlans:
    """Tests for GET /api/v1/retirement/plans/{customer_id}."""

    def test_get_plans_returns_200(self):
        """Should return list of plans for a customer."""
        mock_plan = make_mock_plan()

        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = [mock_plan]

        mock_db = AsyncMock(spec=AsyncSession)
        mock_db.execute = AsyncMock(return_value=mock_result)

        mock_user = make_mock_user()
        app = make_test_app(mock_db, mock_user)

        with TestClient(app) as client:
            response = client.get("/api/v1/retirement/plans/1")

        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) == 1
        assert data[0]["current_age"] == 45
        assert data[0]["annual_return_rate"] == 7.0

    def test_get_plans_returns_empty_list(self):
        """Should return empty list when no plans exist."""
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = []

        mock_db = AsyncMock(spec=AsyncSession)
        mock_db.execute = AsyncMock(return_value=mock_result)

        mock_user = make_mock_user()
        app = make_test_app(mock_db, mock_user)

        with TestClient(app) as client:
            response = client.get("/api/v1/retirement/plans/999")

        assert response.status_code == 200
        assert response.json() == []


# ---------------------------------------------------------------------------
# POST /api/v1/retirement/plans
# ---------------------------------------------------------------------------

class TestCreateRetirementPlan:
    """Tests for POST /api/v1/retirement/plans."""

    def test_create_returns_201(self):
        """Should create and return a new retirement plan."""
        mock_plan = make_mock_plan(id=1)

        mock_db = AsyncMock(spec=AsyncSession)
        mock_db.add = MagicMock()
        mock_db.commit = AsyncMock()
        mock_db.refresh = AsyncMock()

        mock_user = make_mock_user()
        app = make_test_app(mock_db, mock_user)

        with patch("app.api.v1.retirement_plans.RetirementPlan", return_value=mock_plan):
            with TestClient(app) as client:
                response = client.post(
                    "/api/v1/retirement/plans",
                    json={
                        "profile_id": "profile-uuid-001",
                        "current_age": 45,
                        "annual_return_rate": 7.0,
                        "lump_sum_amount": 50000,
                        "annual_savings": 12000,
                        "saving_period_years": 15,
                        "inflation_rate": 2.0,
                        "target_retirement_fund": 500000,
                        "target_pension_amount": 3000,
                        "desired_retirement_age": 60,
                        "possible_retirement_age": 62,
                        "inheritance_consideration": False,
                    },
                )

        assert response.status_code == 201
        mock_db.commit.assert_awaited_once()

    def test_create_requires_profile_id(self):
        """Should return 422 when profile_id is missing."""
        mock_db = AsyncMock(spec=AsyncSession)
        mock_user = make_mock_user()
        app = make_test_app(mock_db, mock_user)

        with TestClient(app) as client:
            response = client.post(
                "/api/v1/retirement/plans",
                json={"current_age": 45, "annual_return_rate": 7.0},  # missing profile_id
            )

        assert response.status_code == 422

    def test_create_requires_annual_return_rate(self):
        """Should return 422 when annual_return_rate is missing."""
        mock_db = AsyncMock(spec=AsyncSession)
        mock_user = make_mock_user()
        app = make_test_app(mock_db, mock_user)

        with TestClient(app) as client:
            response = client.post(
                "/api/v1/retirement/plans",
                json={"profile_id": "profile-uuid-001", "current_age": 45},  # missing annual_return_rate
            )

        assert response.status_code == 422

    def test_create_requires_current_age(self):
        """Should return 422 when current_age is missing."""
        mock_db = AsyncMock(spec=AsyncSession)
        mock_user = make_mock_user()
        app = make_test_app(mock_db, mock_user)

        with TestClient(app) as client:
            response = client.post(
                "/api/v1/retirement/plans",
                json={"profile_id": "profile-uuid-001", "annual_return_rate": 7.0},  # missing current_age
            )

        assert response.status_code == 422


# ---------------------------------------------------------------------------
# PUT /api/v1/retirement/plans/{id}
# ---------------------------------------------------------------------------

class TestUpdateRetirementPlan:
    """Tests for PUT /api/v1/retirement/plans/{id}."""

    def test_update_returns_200(self):
        """Should update and return the modified retirement plan."""
        mock_plan = make_mock_plan(id=1)

        mock_db = AsyncMock(spec=AsyncSession)
        mock_db.get = AsyncMock(return_value=mock_plan)
        mock_db.commit = AsyncMock()
        mock_db.refresh = AsyncMock()

        mock_user = make_mock_user()
        app = make_test_app(mock_db, mock_user)

        with TestClient(app) as client:
            response = client.put(
                "/api/v1/retirement/plans/1",
                json={"annual_return_rate": 8.0, "desired_retirement_age": 58},
            )

        assert response.status_code == 200
        mock_db.commit.assert_awaited_once()

    def test_update_returns_404_when_not_found(self):
        """Should return 404 when plan does not exist."""
        mock_db = AsyncMock(spec=AsyncSession)
        mock_db.get = AsyncMock(return_value=None)

        mock_user = make_mock_user()
        app = make_test_app(mock_db, mock_user)

        with TestClient(app) as client:
            response = client.put(
                "/api/v1/retirement/plans/999",
                json={"annual_return_rate": 8.0},
            )

        assert response.status_code == 404


# ---------------------------------------------------------------------------
# POST /api/v1/retirement/simulation/calculate
# ---------------------------------------------------------------------------

class TestSimulationCalculate:
    """Tests for POST /api/v1/retirement/simulation/calculate."""

    def test_simulation_returns_200(self):
        """Should return simulation result with yearly projections."""
        mock_db = AsyncMock(spec=AsyncSession)
        mock_user = make_mock_user()
        app = make_test_app(mock_db, mock_user)

        with TestClient(app) as client:
            response = client.post(
                "/api/v1/retirement/simulation/calculate",
                json={
                    "current_age": 45,
                    "annual_return_rate": 7.0,
                    "lump_sum_amount": 50000,
                    "annual_savings": 12000,
                    "saving_period_years": 15,
                    "target_pension_amount": 3000,
                },
            )

        assert response.status_code == 200
        data = response.json()
        assert "yearly_projections" in data
        assert isinstance(data["yearly_projections"], list)
        assert len(data["yearly_projections"]) > 0

    def test_simulation_returns_projections_up_to_100(self):
        """Should return projections until age 100."""
        mock_db = AsyncMock(spec=AsyncSession)
        mock_user = make_mock_user()
        app = make_test_app(mock_db, mock_user)

        with TestClient(app) as client:
            response = client.post(
                "/api/v1/retirement/simulation/calculate",
                json={
                    "current_age": 45,
                    "annual_return_rate": 7.0,
                    "lump_sum_amount": 50000,
                    "annual_savings": 12000,
                    "saving_period_years": 15,
                    "target_pension_amount": 3000,
                },
            )

        assert response.status_code == 200
        data = response.json()
        projections = data["yearly_projections"]
        # 45세부터 100세까지 = 56개 항목
        assert len(projections) == 56
        assert projections[0]["age"] == 45
        assert projections[-1]["age"] == 100

    def test_simulation_projection_has_required_fields(self):
        """Each projection entry should have required fields."""
        mock_db = AsyncMock(spec=AsyncSession)
        mock_user = make_mock_user()
        app = make_test_app(mock_db, mock_user)

        with TestClient(app) as client:
            response = client.post(
                "/api/v1/retirement/simulation/calculate",
                json={
                    "current_age": 45,
                    "annual_return_rate": 7.0,
                    "lump_sum_amount": 50000,
                    "annual_savings": 12000,
                    "saving_period_years": 15,
                    "target_pension_amount": 3000,
                },
            )

        assert response.status_code == 200
        proj = response.json()["yearly_projections"][0]
        assert "year" in proj
        assert "year_num" in proj
        assert "age" in proj
        assert "evaluation" in proj

    def test_simulation_requires_current_age(self):
        """Should return 422 when current_age is missing."""
        mock_db = AsyncMock(spec=AsyncSession)
        mock_user = make_mock_user()
        app = make_test_app(mock_db, mock_user)

        with TestClient(app) as client:
            response = client.post(
                "/api/v1/retirement/simulation/calculate",
                json={"annual_return_rate": 7.0},
            )

        assert response.status_code == 422

    def test_simulation_requires_annual_return_rate(self):
        """Should return 422 when annual_return_rate is missing."""
        mock_db = AsyncMock(spec=AsyncSession)
        mock_user = make_mock_user()
        app = make_test_app(mock_db, mock_user)

        with TestClient(app) as client:
            response = client.post(
                "/api/v1/retirement/simulation/calculate",
                json={"current_age": 45},
            )

        assert response.status_code == 422

    def test_simulation_first_year_includes_lump_sum(self):
        """First year evaluation should include lump_sum_amount."""
        mock_db = AsyncMock(spec=AsyncSession)
        mock_user = make_mock_user()
        app = make_test_app(mock_db, mock_user)

        with TestClient(app) as client:
            response = client.post(
                "/api/v1/retirement/simulation/calculate",
                json={
                    "current_age": 45,
                    "annual_return_rate": 10.0,
                    "lump_sum_amount": 100000,
                    "annual_savings": 0,
                    "saving_period_years": 1,
                    "target_pension_amount": 0,
                },
            )

        assert response.status_code == 200
        projections = response.json()["yearly_projections"]
        first = projections[0]
        # 첫해 평가: 100000 * 1.1 = 110000 (10% 수익)
        assert first["evaluation"] == pytest.approx(110000, rel=1e-3)
