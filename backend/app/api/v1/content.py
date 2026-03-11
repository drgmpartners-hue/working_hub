"""Content project and version endpoints."""
from __future__ import annotations

import os
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.db.session import get_db
from app.schemas.content import (
    ContentProjectCreate,
    ContentProjectResponse,
    ContentProjectUpdate,
    ContentVersionCreate,
    ContentVersionResponse,
)
from app.services import content_service

router = APIRouter(prefix="/content", tags=["content"])

DbDep = Annotated[AsyncSession, Depends(get_db)]


# ---------------------------------------------------------------------------
# Content Projects
# ---------------------------------------------------------------------------


@router.post(
    "",
    response_model=ContentProjectResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a content project",
)
async def create_project(
    data: ContentProjectCreate,
    current_user: CurrentUser,
    db: DbDep,
) -> ContentProjectResponse:
    """Create a new content project with status 'draft'."""
    project = await content_service.create_project(db, current_user.id, data)
    return ContentProjectResponse.model_validate(project)


@router.get(
    "",
    response_model=list[ContentProjectResponse],
    summary="List content projects",
)
async def list_projects(
    current_user: CurrentUser,
    db: DbDep,
) -> list[ContentProjectResponse]:
    """Return all content projects owned by the authenticated user."""
    projects = await content_service.get_projects(db, current_user.id)
    return [ContentProjectResponse.model_validate(p) for p in projects]


@router.get(
    "/{project_id}",
    response_model=ContentProjectResponse,
    summary="Get a content project",
)
async def get_project(
    project_id: str,
    current_user: CurrentUser,
    db: DbDep,
) -> ContentProjectResponse:
    """Return a single content project owned by the authenticated user."""
    project = await content_service.get_project(db, current_user.id, project_id)
    return ContentProjectResponse.model_validate(project)


@router.put(
    "/{project_id}",
    response_model=ContentProjectResponse,
    summary="Update a content project",
)
async def update_project(
    project_id: str,
    data: ContentProjectUpdate,
    current_user: CurrentUser,
    db: DbDep,
) -> ContentProjectResponse:
    """Update title, topic, content_input, brand_setting_id or status."""
    project = await content_service.update_project(
        db, current_user.id, project_id, data
    )
    return ContentProjectResponse.model_validate(project)


# ---------------------------------------------------------------------------
# Content Versions
# ---------------------------------------------------------------------------


@router.get(
    "/{project_id}/versions",
    response_model=list[ContentVersionResponse],
    summary="List versions for a project",
)
async def list_versions(
    project_id: str,
    current_user: CurrentUser,
    db: DbDep,
) -> list[ContentVersionResponse]:
    """Return all versions for the given project (owned by the current user)."""
    # Verify project ownership first
    await content_service.get_project(db, current_user.id, project_id)
    versions = await content_service.get_versions(db, project_id)
    return [ContentVersionResponse.model_validate(v) for v in versions]


@router.post(
    "/{project_id}/versions",
    response_model=ContentVersionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new content version (AI generation)",
)
async def create_version(
    project_id: str,
    data: ContentVersionCreate,
    current_user: CurrentUser,
    db: DbDep,
) -> ContentVersionResponse:
    """Trigger AI generation for a new version of the project.

    Optionally supply *ai_text_content* to override the generated text (useful
    for re-generating with user-modified copy).
    """
    project = await content_service.get_project(db, current_user.id, project_id)
    version = await content_service.create_version(
        db, project, text_override=data.ai_text_content
    )
    return ContentVersionResponse.model_validate(version)


@router.get(
    "/{project_id}/versions/{version_id}/download",
    summary="Download a generated file for a version",
)
async def download_version(
    project_id: str,
    version_id: str,
    current_user: CurrentUser,
    db: DbDep,
) -> FileResponse:
    """Return the generated file for the specified version as a download."""
    # Verify project ownership
    await content_service.get_project(db, current_user.id, project_id)

    version = await content_service.get_version(db, project_id, version_id)

    if not version.file_path:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No file has been generated for this version yet.",
        )

    # In production the file_path would be an absolute path on the server
    # (or a cloud storage URL).  For this mock implementation we check a
    # local "generated/" directory relative to the process cwd.
    if not os.path.exists(version.file_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Generated file not found on server: {version.file_path}",
        )

    file_name = os.path.basename(version.file_path)
    return FileResponse(
        path=version.file_path,
        filename=file_name,
        media_type="application/octet-stream",
    )
