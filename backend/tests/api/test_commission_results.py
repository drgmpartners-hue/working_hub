"""Tests for the Commission Results API.

Covers:
  GET  /api/v1/commissions/{calc_id}/results              — list results
  GET  /api/v1/commissions/{calc_id}/results/{id}/download — PDF download

Strategy
--------
- In-memory SQLite via aiosqlite with JSONB → JSON patch.
- A calculation is created first so results exist to query.
- PDF download is tested for an existing result (reportlab must be installed).
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
# In-memory SQLite engine (separate from test_commissions.py)
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


async def override_get_db():
    async with TestingSessionLocal() as session:
        yield session


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture(scope="module", autouse=True)
async def create_tables():
    """Create all ORM tables with JSONB → JSON patch."""
    import app.models  # noqa: F401
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
    """AsyncClient with DB override."""
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

TEST_EMAIL = "results_test@example.com"
TEST_PASSWORD = "Secure1234!"
TEST_NICKNAME = "resultstester"


async def _register_and_login(client: AsyncClient) -> str:
    await client.post(
        "/api/v1/auth/register",
        json={"email": TEST_EMAIL, "password": TEST_PASSWORD, "nickname": TEST_NICKNAME},
    )
    resp = await client.post(
        "/api/v1/auth/login/json",
        json={"email": TEST_EMAIL, "password": TEST_PASSWORD},
    )
    return resp.json()["access_token"]


async def _create_calculation(client: AsyncClient, token: str) -> str:
    """Create a dr_gm calculation and return its id."""
    resp = await client.post(
        "/api/v1/commissions",
        json={
            "calc_type": "dr_gm",
            "source_file_path": "uploads/test.xlsx",
            "input_data": {
                "employees": [
                    {"name": "Alice", "base_salary": 3000000, "commission_rate": 0.05},
                    {"name": "Bob", "base_salary": 2000000, "commission_rate": 0.04},
                ]
            },
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


# ---------------------------------------------------------------------------
# Tests: GET /api/v1/commissions/{calc_id}/results
# ---------------------------------------------------------------------------

class TestListCommissionResults:
    """GET /api/v1/commissions/{calc_id}/results"""

    async def test_list_results_returns_correct_count(self, client: AsyncClient):
        token = await _register_and_login(client)
        calc_id = await _create_calculation(client, token)

        resp = await client.get(
            f"/api/v1/commissions/{calc_id}/results",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert "items" in body
        assert "total" in body
        assert body["total"] == 2  # Alice + Bob

    async def test_list_results_has_employee_name(self, client: AsyncClient):
        token = await _register_and_login(client)
        calc_id = await _create_calculation(client, token)

        resp = await client.get(
            f"/api/v1/commissions/{calc_id}/results",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200, resp.text
        names = {item["employee_name"] for item in resp.json()["items"]}
        assert "Alice" in names
        assert "Bob" in names

    async def test_list_results_has_commission_amount(self, client: AsyncClient):
        token = await _register_and_login(client)
        calc_id = await _create_calculation(client, token)

        resp = await client.get(
            f"/api/v1/commissions/{calc_id}/results",
            headers={"Authorization": f"Bearer {token}"},
        )
        for item in resp.json()["items"]:
            assert "detail_data" in item
            assert "commission_amount" in item["detail_data"]

    async def test_list_results_nonexistent_calc_returns_404(self, client: AsyncClient):
        token = await _register_and_login(client)
        resp = await client.get(
            "/api/v1/commissions/nonexistent-id/results",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 404

    async def test_list_results_requires_auth(self, client: AsyncClient):
        resp = await client.get("/api/v1/commissions/some-id/results")
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Tests: GET /api/v1/commissions/{calc_id}/results/{id}/download
# ---------------------------------------------------------------------------

class TestDownloadCommissionResultPdf:
    """GET /api/v1/commissions/{calc_id}/results/{result_id}/download"""

    async def test_download_returns_pdf(self, client: AsyncClient):
        token = await _register_and_login(client)
        calc_id = await _create_calculation(client, token)

        # Get first result id
        list_resp = await client.get(
            f"/api/v1/commissions/{calc_id}/results",
            headers={"Authorization": f"Bearer {token}"},
        )
        result_id = list_resp.json()["items"][0]["id"]

        resp = await client.get(
            f"/api/v1/commissions/{calc_id}/results/{result_id}/download",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200, resp.text
        assert resp.headers["content-type"] == "application/pdf"
        # PDF magic bytes
        assert resp.content[:4] == b"%PDF"

    async def test_download_nonexistent_result_returns_404(self, client: AsyncClient):
        token = await _register_and_login(client)
        calc_id = await _create_calculation(client, token)

        resp = await client.get(
            f"/api/v1/commissions/{calc_id}/results/nonexistent-result/download",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 404

    async def test_download_nonexistent_calc_returns_404(self, client: AsyncClient):
        token = await _register_and_login(client)
        resp = await client.get(
            "/api/v1/commissions/nonexistent/results/nonexistent/download",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 404

    async def test_download_requires_auth(self, client: AsyncClient):
        resp = await client.get(
            "/api/v1/commissions/some-id/results/some-result/download"
        )
        assert resp.status_code == 401

    async def test_download_cached_on_second_request(self, client: AsyncClient):
        """Second download should return the same PDF (file path cached)."""
        token = await _register_and_login(client)
        calc_id = await _create_calculation(client, token)

        list_resp = await client.get(
            f"/api/v1/commissions/{calc_id}/results",
            headers={"Authorization": f"Bearer {token}"},
        )
        result_id = list_resp.json()["items"][0]["id"]
        url = f"/api/v1/commissions/{calc_id}/results/{result_id}/download"
        headers = {"Authorization": f"Bearer {token}"}

        resp1 = await client.get(url, headers=headers)
        resp2 = await client.get(url, headers=headers)

        assert resp1.status_code == 200
        assert resp2.status_code == 200
        # Both requests should succeed and return identical content
        assert resp1.content == resp2.content
