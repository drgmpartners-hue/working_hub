"""Tests for Content Versions API (P4-R2-T1).

Tests run against the FastAPI test client with mocked database and auth so
no live PostgreSQL instance is required.
"""
import pytest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1.content import router as content_router
from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.content import ContentProject, ContentVersion
from app.models.user import User


# ---------------------------------------------------------------------------
# Helpers / factories
# ---------------------------------------------------------------------------

_NOW = datetime(2026, 3, 11, 0, 0, 0, tzinfo=timezone.utc)


def _make_fake_user(user_id: str = "user-001") -> User:
    user = MagicMock(spec=User)
    user.id = user_id
    user.is_active = True
    return user


def _make_fake_project(
    project_id: str = "proj-001",
    user_id: str = "user-001",
    content_type: str = "card_news",
    title: str = "Test Project",
    status: str = "draft",
) -> ContentProject:
    project = MagicMock(spec=ContentProject)
    project.id = project_id
    project.user_id = user_id
    project.content_type = content_type
    project.title = title
    project.topic = "테스트 주제"
    project.content_input = "테스트 내용"
    project.brand_setting_id = None
    project.status = status
    project.created_at = _NOW
    return project


def _make_fake_version(
    version_id: str = "ver-001",
    project_id: str = "proj-001",
    version_number: int = 1,
    ai_text_content: str = "AI generated text",
    file_path: str | None = "generated/card_news/slide_1.png",
    is_approved: bool = False,
) -> ContentVersion:
    version = MagicMock(spec=ContentVersion)
    version.id = version_id
    version.project_id = project_id
    version.version_number = version_number
    version.ai_text_content = ai_text_content
    version.generated_assets = {
        "type": "card_news",
        "files": [{"page": 1, "path": "generated/card_news/slide_1.png"}],
        "status": "mock",
    }
    version.file_path = file_path
    version.is_approved = is_approved
    version.created_at = _NOW
    return version


def _make_mock_db_project_only(project: ContentProject | None) -> AsyncMock:
    """Mock DB for project lookup only (no version calls)."""
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = project
    mock_db = AsyncMock()
    mock_db.execute = AsyncMock(return_value=mock_result)
    return mock_db


def _make_mock_db_for_version_list(
    project: ContentProject | None,
    versions: list,
) -> AsyncMock:
    """Mock DB that returns project on first execute, then versions on second."""
    project_result = MagicMock()
    project_result.scalar_one_or_none.return_value = project

    version_scalars = MagicMock()
    version_scalars.all.return_value = versions
    version_result = MagicMock()
    version_result.scalars.return_value = version_scalars

    mock_db = AsyncMock()
    mock_db.execute = AsyncMock(side_effect=[project_result, version_result])
    return mock_db


def _make_mock_db_for_version_create(
    project: ContentProject | None,
    existing_count: int = 0,
) -> AsyncMock:
    """Mock DB for creating a new version."""
    import uuid as _uuid

    project_result = MagicMock()
    project_result.scalar_one_or_none.return_value = project

    count_result = MagicMock()
    count_result.scalar_one.return_value = existing_count

    def _fake_refresh(obj):
        if not getattr(obj, "id", None):
            obj.id = str(_uuid.uuid4())
        if not getattr(obj, "created_at", None):
            obj.created_at = _NOW
        if not getattr(obj, "version_number", None):
            obj.version_number = existing_count + 1
        if not hasattr(obj, "project_id") or obj.project_id is None:
            obj.project_id = project.id if project else "proj-001"
        if not hasattr(obj, "is_approved"):
            obj.is_approved = False
        if not hasattr(obj, "ai_text_content"):
            obj.ai_text_content = "Mock AI text"
        if not hasattr(obj, "generated_assets"):
            obj.generated_assets = {}
        if not hasattr(obj, "file_path"):
            obj.file_path = None

    mock_db = AsyncMock()
    mock_db.execute = AsyncMock(side_effect=[project_result, count_result])
    mock_db.add = MagicMock()
    mock_db.commit = AsyncMock()
    mock_db.refresh = AsyncMock(side_effect=_fake_refresh)
    return mock_db


def _make_app(mock_db: AsyncMock, user_id: str = "user-001") -> FastAPI:
    app = FastAPI()
    fake_user = _make_fake_user(user_id)
    app.dependency_overrides[get_current_user] = lambda: fake_user
    app.dependency_overrides[get_db] = lambda: mock_db
    app.include_router(content_router, prefix="/api/v1")
    return app


# ---------------------------------------------------------------------------
# GET /api/v1/content/{project_id}/versions
# ---------------------------------------------------------------------------

class TestListVersions:

    def test_list_versions_returns_200(self):
        fake_project = _make_fake_project()
        versions = [_make_fake_version("v1", version_number=1)]
        mock_db = _make_mock_db_for_version_list(fake_project, versions)
        app = _make_app(mock_db)

        with TestClient(app) as client:
            response = client.get("/api/v1/content/proj-001/versions")

        assert response.status_code == 200

    def test_list_versions_returns_list(self):
        fake_project = _make_fake_project()
        versions = [
            _make_fake_version("v1", version_number=1),
            _make_fake_version("v2", version_number=2),
        ]
        mock_db = _make_mock_db_for_version_list(fake_project, versions)
        app = _make_app(mock_db)

        with TestClient(app) as client:
            response = client.get("/api/v1/content/proj-001/versions")

        data = response.json()
        assert isinstance(data, list)
        assert len(data) == 2

    def test_list_versions_project_not_found(self):
        mock_db = _make_mock_db_project_only(None)
        app = _make_app(mock_db)

        with TestClient(app) as client:
            response = client.get("/api/v1/content/nonexistent-id/versions")

        assert response.status_code == 404

    def test_list_versions_empty(self):
        fake_project = _make_fake_project()
        mock_db = _make_mock_db_for_version_list(fake_project, [])
        app = _make_app(mock_db)

        with TestClient(app) as client:
            response = client.get("/api/v1/content/proj-001/versions")

        assert response.status_code == 200
        assert response.json() == []

    def test_list_versions_requires_authentication(self):
        app_no_auth = FastAPI()
        app_no_auth.include_router(content_router, prefix="/api/v1")
        client = TestClient(app_no_auth, raise_server_exceptions=False)
        response = client.get("/api/v1/content/proj-001/versions")
        assert response.status_code == 401


# ---------------------------------------------------------------------------
# POST /api/v1/content/{project_id}/versions
# ---------------------------------------------------------------------------

class TestCreateVersion:

    def test_create_version_returns_201(self):
        fake_project = _make_fake_project()
        mock_db = _make_mock_db_for_version_create(fake_project, existing_count=0)
        app = _make_app(mock_db)

        with TestClient(app) as client:
            response = client.post("/api/v1/content/proj-001/versions", json={})

        assert response.status_code == 201

    def test_create_version_response_schema(self):
        fake_project = _make_fake_project()
        mock_db = _make_mock_db_for_version_create(fake_project, existing_count=0)
        app = _make_app(mock_db)

        with TestClient(app) as client:
            response = client.post("/api/v1/content/proj-001/versions", json={})

        assert response.status_code == 201
        data = response.json()
        for field in ("id", "project_id", "version_number", "is_approved", "created_at"):
            assert field in data, f"Missing field: {field}"
        assert data["is_approved"] is False

    def test_create_version_with_text_override(self):
        fake_project = _make_fake_project()
        mock_db = _make_mock_db_for_version_create(fake_project, existing_count=0)
        app = _make_app(mock_db)

        override_text = "사용자가 직접 작성한 텍스트"
        with TestClient(app) as client:
            response = client.post(
                "/api/v1/content/proj-001/versions",
                json={"ai_text_content": override_text},
            )

        assert response.status_code == 201

    def test_create_version_project_not_found(self):
        mock_db = _make_mock_db_project_only(None)
        app = _make_app(mock_db)

        with TestClient(app) as client:
            response = client.post("/api/v1/content/nonexistent-id/versions", json={})

        assert response.status_code == 404

    def test_create_version_requires_authentication(self):
        app_no_auth = FastAPI()
        app_no_auth.include_router(content_router, prefix="/api/v1")
        client = TestClient(app_no_auth, raise_server_exceptions=False)
        response = client.post("/api/v1/content/proj-001/versions", json={})
        assert response.status_code == 401

    def test_create_version_increments_version_number(self):
        """Version number should be existing_count + 1."""
        fake_project = _make_fake_project()
        mock_db = _make_mock_db_for_version_create(fake_project, existing_count=2)
        app = _make_app(mock_db)

        with TestClient(app) as client:
            response = client.post("/api/v1/content/proj-001/versions", json={})

        assert response.status_code == 201
        data = response.json()
        assert data["version_number"] == 3


# ---------------------------------------------------------------------------
# GET /api/v1/content/{project_id}/versions/{version_id}/download
# ---------------------------------------------------------------------------

class TestDownloadVersion:

    def test_download_version_no_file_path_returns_404(self):
        fake_project = _make_fake_project()
        fake_version = _make_fake_version(file_path=None)

        project_result = MagicMock()
        project_result.scalar_one_or_none.return_value = fake_project

        version_result = MagicMock()
        version_result.scalar_one_or_none.return_value = fake_version

        mock_db = AsyncMock()
        mock_db.execute = AsyncMock(side_effect=[project_result, version_result])

        app = _make_app(mock_db)

        with TestClient(app) as client:
            response = client.get("/api/v1/content/proj-001/versions/ver-001/download")

        assert response.status_code == 404

    def test_download_version_file_not_on_disk_returns_404(self):
        fake_project = _make_fake_project()
        fake_version = _make_fake_version(file_path="/nonexistent/path/file.png")

        project_result = MagicMock()
        project_result.scalar_one_or_none.return_value = fake_project

        version_result = MagicMock()
        version_result.scalar_one_or_none.return_value = fake_version

        mock_db = AsyncMock()
        mock_db.execute = AsyncMock(side_effect=[project_result, version_result])

        app = _make_app(mock_db)

        with TestClient(app) as client:
            response = client.get("/api/v1/content/proj-001/versions/ver-001/download")

        assert response.status_code == 404

    def test_download_version_project_not_found(self):
        mock_db = _make_mock_db_project_only(None)
        app = _make_app(mock_db)

        with TestClient(app) as client:
            response = client.get("/api/v1/content/nonexistent/versions/ver-001/download")

        assert response.status_code == 404


# ---------------------------------------------------------------------------
# AI service unit tests
# ---------------------------------------------------------------------------

class TestAIService:

    def test_generate_text_card_news(self):
        from app.services.ai_service import generate_text
        result = generate_text("card_news", topic="투자 전략", content_input="시장 분석")
        assert isinstance(result, str)
        assert len(result) > 0
        assert "투자 전략" in result

    def test_generate_text_report(self):
        from app.services.ai_service import generate_text
        result = generate_text("report", topic="월간 리포트")
        assert isinstance(result, str)
        assert "월간 리포트" in result

    def test_generate_text_cover_promo(self):
        from app.services.ai_service import generate_text
        result = generate_text("cover_promo", topic="프로모션")
        assert isinstance(result, str)
        assert len(result) > 0

    def test_generate_text_no_topic(self):
        from app.services.ai_service import generate_text
        result = generate_text("card_news")
        assert isinstance(result, str)
        assert "주제 미입력" in result

    def test_generate_design_card_news(self):
        from app.services.ai_service import generate_design
        assets = generate_design("card_news", text_content="Some text")
        assert assets["type"] == "card_news"
        assert len(assets["files"]) == 5
        assert "preview_path" in assets

    def test_generate_design_report(self):
        from app.services.ai_service import generate_design
        assets = generate_design("report", text_content="Report text")
        assert assets["type"] == "report"
        assert "pdf_path" in assets
        assert len(assets["files"]) == 10

    def test_generate_design_cover_promo(self):
        from app.services.ai_service import generate_design
        assets = generate_design("cover_promo", text_content="Promo text")
        assert assets["type"] == "cover_promo"
        assert len(assets["files"]) == 3

    def test_generate_design_uses_brand_settings(self):
        from app.services.ai_service import generate_design
        brand = {"primary_color": "#FF0000", "font_family": "Arial"}
        assets = generate_design("card_news", text_content="text", brand_settings=brand)
        assert assets["primary_color"] == "#FF0000"
        assert assets["font_family"] == "Arial"


# ---------------------------------------------------------------------------
# ContentVersion schema unit tests
# ---------------------------------------------------------------------------

class TestVersionSchemas:

    def test_version_create_empty(self):
        from app.schemas.content import ContentVersionCreate
        version_in = ContentVersionCreate()
        assert version_in.ai_text_content is None

    def test_version_create_with_text(self):
        from app.schemas.content import ContentVersionCreate
        version_in = ContentVersionCreate(ai_text_content="Custom text")
        assert version_in.ai_text_content == "Custom text"

    def test_version_response_from_orm(self):
        from app.schemas.content import ContentVersionResponse
        fake_version = _make_fake_version()
        response = ContentVersionResponse.model_validate(fake_version)
        assert response.id == "ver-001"
        assert response.version_number == 1
        assert response.is_approved is False
