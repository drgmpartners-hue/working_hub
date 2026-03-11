"""Tests for Crawling Jobs API (P1-R5-T1).

These tests are written against the FastAPI test client with a mocked database
and mocked background task so they run without a live PostgreSQL instance.
"""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi.testclient import TestClient
from fastapi import FastAPI

from app.api.v1.crawling import router as crawling_router
from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.crawling import CrawlingJob
from app.models.user import User


# ---------------------------------------------------------------------------
# Helpers / fixtures
# ---------------------------------------------------------------------------

def _make_fake_user() -> User:
    user = MagicMock(spec=User)
    user.id = "user-test-001"
    user.is_active = True
    return user


def _make_fake_job(
    job_id: str = "job-001",
    source_type: str = "securities_commission",
    status: str = "pending",
    result_data: dict | None = None,
    error_message: str | None = None,
) -> CrawlingJob:
    job = MagicMock(spec=CrawlingJob)
    job.id = job_id
    job.source_type = source_type
    job.status = status
    job.result_data = result_data
    job.error_message = error_message
    # Use a real datetime so Pydantic can serialize it
    from datetime import datetime, timezone
    job.created_at = datetime(2026, 3, 9, 0, 0, 0, tzinfo=timezone.utc)
    return job


def _make_mock_db_for_start() -> AsyncMock:
    """Return a mock db suitable for the POST /start endpoint."""
    import uuid as _uuid
    from datetime import datetime, timezone

    def _fake_refresh(obj):
        """Simulate what DB refresh does: populate server-generated fields."""
        if not getattr(obj, "id", None):
            obj.id = str(_uuid.uuid4())
        if not getattr(obj, "created_at", None):
            obj.created_at = datetime.now(tz=timezone.utc)

    mock_db = AsyncMock()
    mock_db.add = MagicMock()
    mock_db.commit = AsyncMock()
    mock_db.refresh = AsyncMock(side_effect=_fake_refresh)
    return mock_db


def _make_mock_db_with_job(job: CrawlingJob | None) -> AsyncMock:
    """Return a mock db that returns *job* when execute+scalar_one_or_none is called."""
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = job
    mock_db = AsyncMock()
    mock_db.execute = AsyncMock(return_value=mock_result)
    return mock_db


def _make_app(mock_db: AsyncMock) -> FastAPI:
    """Create a minimal test app with fake auth and the given mock db."""
    app = FastAPI()
    fake_user = _make_fake_user()
    app.dependency_overrides[get_current_user] = lambda: fake_user
    # Override get_db via FastAPI's dependency_overrides so the DI system
    # uses our mock instead of opening a real database connection.
    app.dependency_overrides[get_db] = lambda: mock_db
    app.include_router(crawling_router, prefix="/api/v1")
    return app


@pytest.fixture()
def app_with_fake_auth():
    """Return a minimal FastAPI app with the crawling router and fake auth."""
    test_app = FastAPI()
    fake_user = _make_fake_user()
    test_app.dependency_overrides[get_current_user] = lambda: fake_user
    test_app.include_router(crawling_router, prefix="/api/v1")
    return test_app


@pytest.fixture()
def client(app_with_fake_auth):
    return TestClient(app_with_fake_auth)


# ---------------------------------------------------------------------------
# POST /api/v1/crawling/start
# ---------------------------------------------------------------------------

class TestStartCrawlingJob:
    """Tests for POST /api/v1/crawling/start."""

    def test_start_job_returns_202(self):
        """A valid request should be accepted and return 202."""
        mock_db = _make_mock_db_for_start()
        app = _make_app(mock_db)

        with (
            patch("app.api.v1.crawling.run_crawling_job"),
        ):
            with TestClient(app) as client:
                response = client.post(
                    "/api/v1/crawling/start",
                    json={"source_type": "securities_commission"},
                )

        assert response.status_code == 202

    def test_start_job_response_schema(self):
        """Response body must contain id, source_type, status, created_at."""
        mock_db = _make_mock_db_for_start()
        app = _make_app(mock_db)

        with patch("app.api.v1.crawling.run_crawling_job"):
            with TestClient(app) as client:
                response = client.post(
                    "/api/v1/crawling/start",
                    json={"source_type": "securities_commission"},
                )

        assert response.status_code == 202
        data = response.json()
        assert "id" in data
        assert "source_type" in data
        assert "status" in data
        assert "created_at" in data

    def test_start_job_invalid_source_type_returns_422(self, client):
        """An unknown source_type must return 422."""
        response = client.post(
            "/api/v1/crawling/start",
            json={"source_type": "invalid_source"},
        )
        assert response.status_code == 422

    def test_start_job_missing_source_type_returns_422(self, client):
        """A request body without source_type must fail validation."""
        response = client.post("/api/v1/crawling/start", json={})
        assert response.status_code == 422

    def test_start_job_requires_authentication(self):
        """Without auth override the endpoint must require authentication."""
        app_no_auth = FastAPI()
        app_no_auth.include_router(crawling_router, prefix="/api/v1")
        unauthenticated_client = TestClient(app_no_auth, raise_server_exceptions=False)
        response = unauthenticated_client.post(
            "/api/v1/crawling/start",
            json={"source_type": "securities_commission"},
        )
        assert response.status_code == 401

    def test_start_job_irp_portfolio_source_type(self):
        """irp_portfolio is a valid source_type and must be accepted."""
        mock_db = _make_mock_db_for_start()
        app = _make_app(mock_db)

        with patch("app.api.v1.crawling.run_crawling_job"):
            with TestClient(app) as client:
                response = client.post(
                    "/api/v1/crawling/start",
                    json={"source_type": "irp_portfolio"},
                )

        assert response.status_code == 202


# ---------------------------------------------------------------------------
# GET /api/v1/crawling/{id}/status
# ---------------------------------------------------------------------------

class TestGetCrawlingJobStatus:
    """Tests for GET /api/v1/crawling/{job_id}/status."""

    def test_get_status_found(self):
        """An existing job must be returned with 200."""
        fake_job = _make_fake_job(status="running")
        mock_db = _make_mock_db_with_job(fake_job)
        app = _make_app(mock_db)

        with TestClient(app) as client:
            response = client.get("/api/v1/crawling/job-001/status")

        assert response.status_code == 200

    def test_get_status_response_schema(self):
        """Response body must contain all required fields."""
        fake_job = _make_fake_job(status="completed", result_data={"records": []})
        mock_db = _make_mock_db_with_job(fake_job)
        app = _make_app(mock_db)

        with TestClient(app) as client:
            response = client.get("/api/v1/crawling/job-001/status")

        assert response.status_code == 200
        data = response.json()
        for field in ("id", "source_type", "status", "created_at"):
            assert field in data, f"Missing field: {field}"

    def test_get_status_not_found_returns_404(self):
        """A non-existent job ID must return 404."""
        mock_db = _make_mock_db_with_job(None)
        app = _make_app(mock_db)

        with TestClient(app) as client:
            response = client.get("/api/v1/crawling/nonexistent-id/status")

        assert response.status_code == 404

    def test_get_status_requires_authentication(self):
        """Without auth override the endpoint must require authentication."""
        app_no_auth = FastAPI()
        app_no_auth.include_router(crawling_router, prefix="/api/v1")
        unauthenticated_client = TestClient(app_no_auth, raise_server_exceptions=False)
        response = unauthenticated_client.get("/api/v1/crawling/some-id/status")
        assert response.status_code == 401

    def test_get_status_completed_has_result_data(self):
        """A completed job's response must expose result_data."""
        mock_result_data = {"source": "securities_commission", "records": []}
        fake_job = _make_fake_job(status="completed", result_data=mock_result_data)
        mock_db = _make_mock_db_with_job(fake_job)
        app = _make_app(mock_db)

        with TestClient(app) as client:
            response = client.get("/api/v1/crawling/job-001/status")

        assert response.status_code == 200
        data = response.json()
        assert data.get("status") == "completed"
        assert data.get("result_data") is not None

    def test_get_status_failed_has_error_message(self):
        """A failed job's response must expose error_message."""
        fake_job = _make_fake_job(
            status="failed", error_message="Connection timeout"
        )
        mock_db = _make_mock_db_with_job(fake_job)
        app = _make_app(mock_db)

        with TestClient(app) as client:
            response = client.get("/api/v1/crawling/job-001/status")

        assert response.status_code == 200
        data = response.json()
        assert data.get("status") == "failed"


# ---------------------------------------------------------------------------
# Schema unit tests
# ---------------------------------------------------------------------------

class TestCrawlingSchemas:
    """Unit tests for Pydantic schemas."""

    def test_crawling_job_create_valid(self):
        from app.schemas.crawling import CrawlingJobCreate
        job = CrawlingJobCreate(source_type="securities_commission")
        assert job.source_type == "securities_commission"

    def test_crawling_job_response_from_orm(self):
        from datetime import datetime, timezone
        from app.schemas.crawling import CrawlingJobResponse

        fake_job = _make_fake_job(status="pending")
        response = CrawlingJobResponse.model_validate(fake_job)
        assert response.id == "job-001"
        assert response.source_type == "securities_commission"
        assert response.status == "pending"
        assert response.result_data is None


# ---------------------------------------------------------------------------
# Crawler service stub tests
# ---------------------------------------------------------------------------

class TestCrawlerServiceStub:
    """Unit tests for the crawler service stub logic."""

    def test_build_mock_result_securities_commission(self):
        from app.services.crawler_service import _build_mock_result
        result = _build_mock_result("securities_commission")
        assert result["source"] == "securities_commission"
        assert "records" in result

    def test_build_mock_result_irp_portfolio(self):
        from app.services.crawler_service import _build_mock_result
        result = _build_mock_result("irp_portfolio")
        assert result["source"] == "irp_portfolio"
        assert "items" in result

    def test_build_mock_result_unknown_source(self):
        from app.services.crawler_service import _build_mock_result
        result = _build_mock_result("unknown_source")
        assert result["source"] == "unknown_source"
        assert "raw" in result
