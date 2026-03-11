"""Tests for the Commission Calculations API.

Covers:
  POST /api/v1/commissions           — create calculation
  GET  /api/v1/commissions           — list calculations
  GET  /api/v1/commissions/{id}      — get single calculation

Strategy
--------
- In-memory SQLite via aiosqlite.
- JSONB columns patched to JSON for SQLite compatibility (same technique as
  test_upload.py).
- A real user is registered + logged-in so CurrentUser dependency resolves
  without mocking.
"""
from __future__ import annotations

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import StaticPool

# ---------------------------------------------------------------------------
# In-memory SQLite engine
# ---------------------------------------------------------------------------

SQLITE_URL = "sqlite+aiosqlite:///:memory:"

test_engine = create_async_engine(
    SQLITE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = async_sessionmaker(
    test_engine, class_=AsyncSession, expire_on_commit=False
)


# ---------------------------------------------------------------------------
# DB dependency override
# ---------------------------------------------------------------------------

async def override_get_db():
    async with TestingSessionLocal() as session:
        yield session


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture(scope="module", autouse=True)
async def create_tables():
    """Create all ORM tables (with JSONB → JSON patch) once per module."""
    import app.models  # noqa: F401 — registers all models
    from app.db.base import Base
    from sqlalchemy import JSON
    from sqlalchemy.dialects.postgresql import JSONB

    for table in Base.metadata.tables.values():
        for col in table.columns:
            if isinstance(col.type, JSONB):
                col.type = JSON()

    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest_asyncio.fixture
async def client():
    """AsyncClient wired to the FastAPI app with DB override."""
    from app.main import app
    from app.db.session import get_db

    app.dependency_overrides[get_db] = override_get_db

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

TEST_EMAIL = "commission_test@example.com"
TEST_PASSWORD = "Secure1234!"
TEST_NICKNAME = "commtester"


async def _register_and_login(client: AsyncClient) -> str:
    """Register (idempotent) and return a Bearer token."""
    await client.post(
        "/api/v1/auth/register",
        json={"email": TEST_EMAIL, "password": TEST_PASSWORD, "nickname": TEST_NICKNAME},
    )
    resp = await client.post(
        "/api/v1/auth/login/json",
        json={"email": TEST_EMAIL, "password": TEST_PASSWORD},
    )
    return resp.json()["access_token"]


def _dr_gm_payload() -> dict:
    return {
        "calc_type": "dr_gm",
        "source_file_path": "uploads/sample.xlsx",
        "input_data": {
            "employees": [
                {"name": "Alice", "base_salary": 3000000, "commission_rate": 0.05},
                {"name": "Bob", "base_salary": 2500000},
            ]
        },
    }


def _securities_payload() -> dict:
    return {
        "calc_type": "securities",
        "source_file_path": "uploads/securities.xlsx",
        "input_data": {
            "employees": [
                {"name": "Charlie", "sales_amount": 10000000, "commission_rate": 0.03},
            ]
        },
    }


# ---------------------------------------------------------------------------
# Tests: POST /api/v1/commissions
# ---------------------------------------------------------------------------

class TestCreateCommissionCalculation:
    """POST /api/v1/commissions"""

    async def test_create_dr_gm_returns_201(self, client: AsyncClient):
        token = await _register_and_login(client)
        resp = await client.post(
            "/api/v1/commissions",
            json=_dr_gm_payload(),
            headers={"Authorization": f"Bearer {token}"},
        )

        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert "id" in body
        assert body["calc_type"] == "dr_gm"
        assert body["status"] == "completed"
        assert body["result_data"]["total_employees"] == 2
        # Alice: 3_000_000 * 0.05 = 150_000
        # Bob:   2_500_000 * 0.03 = 75_000  (default rate)
        assert body["result_data"]["total_commission"] == pytest.approx(225000.0)

    async def test_create_securities_returns_201(self, client: AsyncClient):
        token = await _register_and_login(client)
        resp = await client.post(
            "/api/v1/commissions",
            json=_securities_payload(),
            headers={"Authorization": f"Bearer {token}"},
        )

        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["calc_type"] == "securities"
        assert body["status"] == "completed"
        # Charlie: 10_000_000 * 0.03 = 300_000
        assert body["result_data"]["total_commission"] == pytest.approx(300000.0)

    async def test_create_requires_auth(self, client: AsyncClient):
        resp = await client.post("/api/v1/commissions", json=_dr_gm_payload())
        assert resp.status_code == 401

    async def test_create_invalid_calc_type_returns_422(self, client: AsyncClient):
        token = await _register_and_login(client)
        bad_payload = {
            "calc_type": "invalid_type",
            "source_file_path": "uploads/x.xlsx",
            "input_data": {},
        }
        resp = await client.post(
            "/api/v1/commissions",
            json=bad_payload,
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 422

    async def test_create_empty_employees_returns_201(self, client: AsyncClient):
        """Empty employees list is valid — results in zero commission."""
        token = await _register_and_login(client)
        payload = {
            "calc_type": "dr_gm",
            "source_file_path": "uploads/empty.xlsx",
            "input_data": {"employees": []},
        }
        resp = await client.post(
            "/api/v1/commissions",
            json=payload,
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["result_data"]["total_employees"] == 0
        assert body["result_data"]["total_commission"] == 0


# ---------------------------------------------------------------------------
# Tests: GET /api/v1/commissions
# ---------------------------------------------------------------------------

class TestListCommissionCalculations:
    """GET /api/v1/commissions"""

    async def test_list_returns_own_calculations(self, client: AsyncClient):
        token = await _register_and_login(client)

        # Create two calculations
        for _ in range(2):
            await client.post(
                "/api/v1/commissions",
                json=_dr_gm_payload(),
                headers={"Authorization": f"Bearer {token}"},
            )

        resp = await client.get(
            "/api/v1/commissions",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert "items" in body
        assert "total" in body
        assert body["total"] >= 2

    async def test_list_requires_auth(self, client: AsyncClient):
        resp = await client.get("/api/v1/commissions")
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Tests: GET /api/v1/commissions/{calc_id}
# ---------------------------------------------------------------------------

class TestGetCommissionCalculation:
    """GET /api/v1/commissions/{calc_id}"""

    async def test_get_existing_calculation(self, client: AsyncClient):
        token = await _register_and_login(client)

        create_resp = await client.post(
            "/api/v1/commissions",
            json=_dr_gm_payload(),
            headers={"Authorization": f"Bearer {token}"},
        )
        calc_id = create_resp.json()["id"]

        resp = await client.get(
            f"/api/v1/commissions/{calc_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["id"] == calc_id

    async def test_get_nonexistent_returns_404(self, client: AsyncClient):
        token = await _register_and_login(client)
        resp = await client.get(
            "/api/v1/commissions/nonexistent-id",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 404

    async def test_get_requires_auth(self, client: AsyncClient):
        resp = await client.get("/api/v1/commissions/some-id")
        assert resp.status_code == 401
