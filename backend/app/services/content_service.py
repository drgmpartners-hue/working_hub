"""Content project and version service layer."""
from typing import Optional, Sequence
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from fastapi import HTTPException, status

from app.models.content import ContentProject, ContentVersion
from app.schemas.content import (
    ContentProjectCreate,
    ContentProjectUpdate,
    VALID_CONTENT_TYPES,
    VALID_STATUSES,
)
from app.services import ai_service


# ---------------------------------------------------------------------------
# ContentProject helpers
# ---------------------------------------------------------------------------


async def create_project(
    db: AsyncSession,
    user_id: str,
    data: ContentProjectCreate,
) -> ContentProject:
    """Create a new content project with status 'draft'."""
    if data.content_type not in VALID_CONTENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Invalid content_type '{data.content_type}'. "
                f"Allowed values: {sorted(VALID_CONTENT_TYPES)}"
            ),
        )

    project = ContentProject(
        user_id=user_id,
        content_type=data.content_type,
        title=data.title,
        topic=data.topic,
        content_input=data.content_input,
        brand_setting_id=data.brand_setting_id,
        status="draft",
    )
    db.add(project)
    await db.commit()
    await db.refresh(project)
    return project


async def get_projects(
    db: AsyncSession,
    user_id: str,
) -> Sequence[ContentProject]:
    """Return all content projects belonging to the given user."""
    result = await db.execute(
        select(ContentProject)
        .where(ContentProject.user_id == user_id)
        .order_by(ContentProject.created_at.desc())
    )
    return result.scalars().all()


async def get_project(
    db: AsyncSession,
    user_id: str,
    project_id: str,
) -> ContentProject:
    """Return a single content project, raising 404 if not found."""
    result = await db.execute(
        select(ContentProject).where(
            ContentProject.id == project_id,
            ContentProject.user_id == user_id,
        )
    )
    project = result.scalar_one_or_none()
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Content project '{project_id}' not found",
        )
    return project


async def update_project(
    db: AsyncSession,
    user_id: str,
    project_id: str,
    data: ContentProjectUpdate,
) -> ContentProject:
    """Update allowed fields of a content project."""
    project = await get_project(db, user_id, project_id)

    if data.status is not None and data.status not in VALID_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Invalid status '{data.status}'. "
                f"Allowed values: {sorted(VALID_STATUSES)}"
            ),
        )

    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(project, field, value)

    await db.commit()
    await db.refresh(project)
    return project


# ---------------------------------------------------------------------------
# ContentVersion helpers
# ---------------------------------------------------------------------------


async def get_versions(
    db: AsyncSession,
    project_id: str,
) -> Sequence[ContentVersion]:
    """Return all versions for a project, ordered by version_number."""
    result = await db.execute(
        select(ContentVersion)
        .where(ContentVersion.project_id == project_id)
        .order_by(ContentVersion.version_number.asc())
    )
    return result.scalars().all()


async def get_version(
    db: AsyncSession,
    project_id: str,
    version_id: str,
) -> ContentVersion:
    """Return a single content version, raising 404 if not found."""
    result = await db.execute(
        select(ContentVersion).where(
            ContentVersion.id == version_id,
            ContentVersion.project_id == project_id,
        )
    )
    version = result.scalar_one_or_none()
    if version is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Content version '{version_id}' not found for project '{project_id}'",
        )
    return version


async def create_version(
    db: AsyncSession,
    project: ContentProject,
    text_override: Optional[str] = None,
) -> ContentVersion:
    """Generate a new version for the given project.

    If *text_override* is provided it is used as the AI text content (useful
    for re-generating with user-modified text).  Otherwise the mock AI service
    generates fresh text from the project's topic and content_input.

    The version_number is auto-incremented per project.
    """
    # Determine next version number
    count_result = await db.execute(
        select(func.count()).where(ContentVersion.project_id == project.id)
    )
    existing_count: int = count_result.scalar_one()
    next_version_number = existing_count + 1

    # Generate text
    if text_override is not None:
        ai_text = text_override
    else:
        ai_text = ai_service.generate_text(
            content_type=project.content_type,
            topic=project.topic,
            content_input=project.content_input,
        )

    # Generate design assets (mock)
    generated_assets = ai_service.generate_design(
        content_type=project.content_type,
        text_content=ai_text,
    )

    # Derive a mock file_path from the first generated file, if any
    files = generated_assets.get("files", [])
    file_path: Optional[str] = files[0].get("path") if files else None

    version = ContentVersion(
        project_id=project.id,
        version_number=next_version_number,
        ai_text_content=ai_text,
        generated_assets=generated_assets,
        file_path=file_path,
        is_approved=False,
    )
    db.add(version)

    # Update project status to reflect generation completed
    project.status = "completed"

    await db.commit()
    await db.refresh(version)
    return version
