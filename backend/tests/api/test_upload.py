"""Tests for file upload API endpoint.

Covers:
  POST /api/v1/upload/excel

Uses an in-process AsyncClient backed by an in-memory SQLite database so no
running PostgreSQL instance is required.  JSONB columns are mapped to JSON for
SQLite via a type override applied in the test setup.
"""
from __future__ import annotations

import io
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.pool import StaticPool

# ---------------------------------------------------------------------------
# In-memory SQLite engine (aiosqlite driver)
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
# Override get_db dependency
# ---------------------------------------------------------------------------

async def override_get_db():
    async with TestingSessionLocal() as session:
        yield session


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture(scope="module", autouse=True)
async def create_tables():
    """Create all ORM tables in the SQLite in-memory database once per module.

    SQLite does not support JSONB natively.  We patch the column type on the
    FileUpload model to use plain JSON before creating tables.
    """
    import app.models  # noqa: F401 – registers all models with Base.metadata
    from app.db.base import Base
    from sqlalchemy import JSON
    from sqlalchemy.dialects.postgresql import JSONB

    # Patch ALL JSONB -> JSON for SQLite compatibility
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
    """Return an AsyncClient wired to the FastAPI app with DB override."""
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

TEST_EMAIL = "uploader@example.com"
TEST_PASSWORD = "Secure1234!"
TEST_NICKNAME = "uploader"


async def _register_and_login(client: AsyncClient) -> str:
    """Register a fresh user (idempotent) and return a valid Bearer token."""
    await client.post(
        "/api/v1/auth/register",
        json={"email": TEST_EMAIL, "password": TEST_PASSWORD, "nickname": TEST_NICKNAME},
    )
    resp = await client.post(
        "/api/v1/auth/login/json",
        json={"email": TEST_EMAIL, "password": TEST_PASSWORD},
    )
    return resp.json()["access_token"]


def _make_xlsx_bytes(rows: list[list] | None = None) -> bytes:
    """Build a minimal valid .xlsx file in memory using openpyxl."""
    import openpyxl

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Sheet1"

    if rows is None:
        rows = [
            ["name", "age", "city"],
            ["Alice", 30, "Seoul"],
            ["Bob", 25, "Busan"],
        ]

    for row in rows:
        ws.append(row)

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf.read()


# ---------------------------------------------------------------------------
# Tests: POST /api/v1/upload/excel
# ---------------------------------------------------------------------------

class TestUploadExcel:
    """POST /api/v1/upload/excel"""

    async def test_upload_valid_excel_returns_201(self, client: AsyncClient):
        token = await _register_and_login(client)
        xlsx_bytes = _make_xlsx_bytes()

        resp = await client.post(
            "/api/v1/upload/excel",
            files={"file": ("test.xlsx", xlsx_bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            headers={"Authorization": f"Bearer {token}"},
        )

        assert resp.status_code == 201, resp.text
        body = resp.json()

        # Required fields
        assert "id" in body
        assert body["file_name"] == "test.xlsx"
        assert "file_path" in body
        assert body["file_size"] == len(xlsx_bytes)
        assert "uploaded_at" in body

        # Parsed data structure
        pd = body["parsed_data"]
        assert "sheets" in pd
        assert "total_rows" in pd
        assert "data" in pd
        assert "Sheet1" in pd["data"]
        assert pd["total_rows"] == 2  # 2 data rows (header excluded)

        # Data content
        first_row = pd["data"]["Sheet1"][0]
        assert first_row["name"] == "Alice"
        assert first_row["age"] == 30

    async def test_upload_requires_authentication(self, client: AsyncClient):
        xlsx_bytes = _make_xlsx_bytes()
        resp = await client.post(
            "/api/v1/upload/excel",
            files={"file": ("test.xlsx", xlsx_bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        )
        assert resp.status_code == 401

    async def test_upload_invalid_token_returns_401(self, client: AsyncClient):
        xlsx_bytes = _make_xlsx_bytes()
        resp = await client.post(
            "/api/v1/upload/excel",
            files={"file": ("test.xlsx", xlsx_bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            headers={"Authorization": "Bearer bad.token.value"},
        )
        assert resp.status_code == 401

    async def test_upload_wrong_extension_returns_400(self, client: AsyncClient):
        token = await _register_and_login(client)
        resp = await client.post(
            "/api/v1/upload/excel",
            files={"file": ("data.csv", b"col1,col2\n1,2", "text/csv")},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 400
        assert "Unsupported file type" in resp.json()["detail"]

    async def test_upload_empty_file_returns_400(self, client: AsyncClient):
        token = await _register_and_login(client)
        resp = await client.post(
            "/api/v1/upload/excel",
            files={"file": ("empty.xlsx", b"", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 400
        assert "empty" in resp.json()["detail"].lower()

    async def test_upload_corrupted_file_returns_422(self, client: AsyncClient):
        token = await _register_and_login(client)
        # Send garbage bytes with .xlsx extension – openpyxl will fail to parse
        resp = await client.post(
            "/api/v1/upload/excel",
            files={"file": ("bad.xlsx", b"This is not an xlsx file!", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 422

    async def test_upload_header_only_sheet_returns_zero_rows(self, client: AsyncClient):
        """An Excel with only a header row should produce total_rows == 0."""
        token = await _register_and_login(client)
        xlsx_bytes = _make_xlsx_bytes(rows=[["col_a", "col_b"]])

        resp = await client.post(
            "/api/v1/upload/excel",
            files={"file": ("headers_only.xlsx", xlsx_bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["parsed_data"]["total_rows"] == 0
        assert body["parsed_data"]["data"]["Sheet1"] == []


# ---------------------------------------------------------------------------
# Tests: excel_service unit tests (no HTTP layer)
# ---------------------------------------------------------------------------

class TestExcelService:
    """Unit tests for app.services.excel_service.parse_excel_bytes."""

    def test_parse_basic_xlsx(self):
        from app.services.excel_service import parse_excel_bytes

        xlsx_bytes = _make_xlsx_bytes()
        result = parse_excel_bytes(xlsx_bytes)

        assert result["total_rows"] == 2
        assert "Sheet1" in result["sheets"]
        rows = result["data"]["Sheet1"]
        assert rows[0] == {"name": "Alice", "age": 30, "city": "Seoul"}
        assert rows[1] == {"name": "Bob", "age": 25, "city": "Busan"}

    def test_parse_invalid_bytes_raises_value_error(self):
        from app.services.excel_service import parse_excel_bytes
        import pytest

        with pytest.raises(ValueError, match="Cannot parse Excel file"):
            parse_excel_bytes(b"not an xlsx")

    def test_parse_empty_sheet(self):
        from app.services.excel_service import parse_excel_bytes

        xlsx_bytes = _make_xlsx_bytes(rows=[])
        result = parse_excel_bytes(xlsx_bytes)
        assert result["total_rows"] == 0

    def test_parse_skips_all_none_rows(self):
        from app.services.excel_service import parse_excel_bytes

        # Row with a header and one blank row between data rows
        xlsx_bytes = _make_xlsx_bytes(rows=[
            ["col"],
            ["value_a"],
            [None],        # completely empty – should be skipped
            ["value_b"],
        ])
        result = parse_excel_bytes(xlsx_bytes)
        rows = result["data"]["Sheet1"]
        assert len(rows) == 2
        assert rows[0]["col"] == "value_a"
        assert rows[1]["col"] == "value_b"
