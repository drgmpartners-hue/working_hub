"""Tests for Content Projects API (P4-R1-T1).

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
from app.models.content import ContentProject
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


def _make_mock_db_for_create() -> AsyncMock:
    """Mock DB that simulates refresh populating id/created_at."""
    import uuid as _uuid

    def _fake_refresh(obj):
        if not getattr(obj, "id", None):
            obj.id = str(_uuid.uuid4())
        if not getattr(obj, "created_at", None):
            obj.created_at = _NOW

    mock_db = AsyncMock()
    mock_db.add = MagicMock()
    mock_db.commit = AsyncMock()
    mock_db.refresh = AsyncMock(side_effect=_fake_refresh)
    return mock_db


def _make_mock_db_with_project(project: ContentProject | None) -> AsyncMock:
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = project
    mock_db = AsyncMock()
    mock_db.execute = AsyncMock(return_value=mock_result)
    return mock_db


def _make_mock_db_with_projects(projects: list) -> AsyncMock:
    mock_scalars = MagicMock()
    mock_scalars.all.return_value = projects
    mock_result = MagicMock()
    mock_result.scalars.return_value = mock_scalars
    mock_db = AsyncMock()
    mock_db.execute = AsyncMock(return_value=mock_result)
    return mock_db


def _make_app(mock_db: AsyncMock, user_id: str = "user-001") -> FastAPI:
    app = FastAPI()
    fake_user = _make_fake_user(user_id)
    app.dependency_overrides[get_current_user] = lambda: fake_user
    app.dependency_overrides[get_db] = lambda: mock_db
    app.include_router(content_router, prefix="/api/v1")
    return app


# ---------------------------------------------------------------------------
# POST /api/v1/content
# ---------------------------------------------------------------------------

class TestCreateProject:

    def test_create_project_returns_201(self):
        mock_db = _make_mock_db_for_create()
        app = _make_app(mock_db)

        with TestClient(app) as client:
            response = client.post(
                "/api/v1/content",
                json={
                    "content_type": "card_news",
                    "title": "테스트 카드뉴스",
                    "topic": "투자 전략",
                },
            )

        assert response.status_code == 201

    def test_create_project_response_schema(self):
        mock_db = _make_mock_db_for_create()
        app = _make_app(mock_db)

        with TestClient(app) as client:
            response = client.post(
                "/api/v1/content",
                json={
                    "content_type": "report",
                    "title": "월간 리포트",
                    "topic": "시장 분석",
                    "content_input": "2026년 3월 시장 현황",
                },
            )

        assert response.status_code == 201
        data = response.json()
        for field in ("id", "user_id", "content_type", "title", "status", "created_at"):
            assert field in data, f"Missing field: {field}"
        assert data["status"] == "draft"

    def test_create_project_invalid_content_type_returns_422(self):
        mock_db = _make_mock_db_for_create()
        app = _make_app(mock_db)

        with TestClient(app) as client:
            response = client.post(
                "/api/v1/content",
                json={"content_type": "invalid_type", "title": "Test"},
            )

        assert response.status_code == 422

    def test_create_project_missing_title_returns_422(self):
        mock_db = _make_mock_db_for_create()
        app = _make_app(mock_db)

        with TestClient(app) as client:
            response = client.post(
                "/api/v1/content",
                json={"content_type": "card_news"},
            )

        assert response.status_code == 422

    def test_create_project_requires_authentication(self):
        app_no_auth = FastAPI()
        app_no_auth.include_router(content_router, prefix="/api/v1")
        client = TestClient(app_no_auth, raise_server_exceptions=False)
        response = client.post(
            "/api/v1/content",
            json={"content_type": "card_news", "title": "Test"},
        )
        assert response.status_code == 401

    def test_create_project_all_valid_content_types(self):
        for content_type in ("card_news", "report", "cover_promo"):
            mock_db = _make_mock_db_for_create()
            app = _make_app(mock_db)
            with TestClient(app) as client:
                response = client.post(
                    "/api/v1/content",
                    json={"content_type": content_type, "title": f"{content_type} test"},
                )
            assert response.status_code == 201, f"Failed for content_type={content_type}"


# ---------------------------------------------------------------------------
# GET /api/v1/content
# ---------------------------------------------------------------------------

class TestListProjects:

    def test_list_projects_returns_200(self):
        projects = [
            _make_fake_project("p1", content_type="card_news"),
            _make_fake_project("p2", content_type="report"),
        ]
        mock_db = _make_mock_db_with_projects(projects)
        app = _make_app(mock_db)

        with TestClient(app) as client:
            response = client.get("/api/v1/content")

        assert response.status_code == 200

    def test_list_projects_returns_list(self):
        projects = [_make_fake_project()]
        mock_db = _make_mock_db_with_projects(projects)
        app = _make_app(mock_db)

        with TestClient(app) as client:
            response = client.get("/api/v1/content")

        data = response.json()
        assert isinstance(data, list)
        assert len(data) == 1

    def test_list_projects_empty(self):
        mock_db = _make_mock_db_with_projects([])
        app = _make_app(mock_db)

        with TestClient(app) as client:
            response = client.get("/api/v1/content")

        assert response.status_code == 200
        assert response.json() == []

    def test_list_projects_requires_authentication(self):
        app_no_auth = FastAPI()
        app_no_auth.include_router(content_router, prefix="/api/v1")
        client = TestClient(app_no_auth, raise_server_exceptions=False)
        response = client.get("/api/v1/content")
        assert response.status_code == 401


# ---------------------------------------------------------------------------
# GET /api/v1/content/{project_id}
# ---------------------------------------------------------------------------

class TestGetProject:

    def test_get_project_found(self):
        fake_project = _make_fake_project()
        mock_db = _make_mock_db_with_project(fake_project)
        app = _make_app(mock_db)

        with TestClient(app) as client:
            response = client.get("/api/v1/content/proj-001")

        assert response.status_code == 200

    def test_get_project_not_found(self):
        mock_db = _make_mock_db_with_project(None)
        app = _make_app(mock_db)

        with TestClient(app) as client:
            response = client.get("/api/v1/content/nonexistent-id")

        assert response.status_code == 404

    def test_get_project_response_schema(self):
        fake_project = _make_fake_project()
        mock_db = _make_mock_db_with_project(fake_project)
        app = _make_app(mock_db)

        with TestClient(app) as client:
            response = client.get("/api/v1/content/proj-001")

        data = response.json()
        for field in ("id", "user_id", "content_type", "title", "status", "created_at"):
            assert field in data, f"Missing field: {field}"


# ---------------------------------------------------------------------------
# PUT /api/v1/content/{project_id}
# ---------------------------------------------------------------------------

class TestUpdateProject:

    def test_update_project_returns_200(self):
        fake_project = _make_fake_project()

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = fake_project
        mock_db = AsyncMock()
        mock_db.execute = AsyncMock(return_value=mock_result)
        mock_db.commit = AsyncMock()
        mock_db.refresh = AsyncMock()

        app = _make_app(mock_db)

        with TestClient(app) as client:
            response = client.put(
                "/api/v1/content/proj-001",
                json={"title": "Updated Title"},
            )

        assert response.status_code == 200

    def test_update_project_invalid_status_returns_422(self):
        fake_project = _make_fake_project()

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = fake_project
        mock_db = AsyncMock()
        mock_db.execute = AsyncMock(return_value=mock_result)
        mock_db.commit = AsyncMock()
        mock_db.refresh = AsyncMock()

        app = _make_app(mock_db)

        with TestClient(app) as client:
            response = client.put(
                "/api/v1/content/proj-001",
                json={"status": "invalid_status"},
            )

        assert response.status_code == 422


# ---------------------------------------------------------------------------
# Schema unit tests
# ---------------------------------------------------------------------------

class TestContentSchemas:

    def test_project_create_valid(self):
        from app.schemas.content import ContentProjectCreate
        proj = ContentProjectCreate(content_type="card_news", title="Test")
        assert proj.content_type == "card_news"
        assert proj.title == "Test"
        assert proj.topic is None

    def test_project_response_from_orm(self):
        from app.schemas.content import ContentProjectResponse
        fake_project = _make_fake_project()
        response = ContentProjectResponse.model_validate(fake_project)
        assert response.id == "proj-001"
        assert response.status == "draft"

    def test_project_update_all_optional(self):
        from app.schemas.content import ContentProjectUpdate
        update = ContentProjectUpdate()
        assert update.title is None
        assert update.status is None

    def test_valid_content_types(self):
        from app.schemas.content import VALID_CONTENT_TYPES
        assert "card_news" in VALID_CONTENT_TYPES
        assert "report" in VALID_CONTENT_TYPES
        assert "cover_promo" in VALID_CONTENT_TYPES

    def test_valid_statuses(self):
        from app.schemas.content import VALID_STATUSES
        expected = {"draft", "generating", "text_ready", "designing", "completed", "failed"}
        assert expected == VALID_STATUSES
