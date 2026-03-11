"""Crawling job endpoints."""
from typing import Annotated
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.db.session import get_db
from app.models.crawling import CrawlingJob
from app.schemas.crawling import CrawlingJobCreate, CrawlingJobResponse, VALID_SOURCE_TYPES
from app.services.crawler_service import run_crawling_job
from app.core.deps import CurrentUser

router = APIRouter(prefix="/crawling", tags=["crawling"])


@router.post(
    "/start",
    response_model=CrawlingJobResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Start a crawling job",
    description=(
        "Creates a CrawlingJob record with status='pending', launches the job "
        "in the background, and returns immediately with the job ID."
    ),
)
async def start_crawling_job(
    job_in: CrawlingJobCreate,
    background_tasks: BackgroundTasks,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> CrawlingJobResponse:
    """Start a new crawling job asynchronously."""
    if job_in.source_type not in VALID_SOURCE_TYPES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Invalid source_type '{job_in.source_type}'. "
                f"Allowed values: {sorted(VALID_SOURCE_TYPES)}"
            ),
        )

    job = CrawlingJob(
        source_type=job_in.source_type,
        status="pending",
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    background_tasks.add_task(run_crawling_job, job.id, job.source_type)

    return CrawlingJobResponse.model_validate(job)


@router.get(
    "/{job_id}/status",
    response_model=CrawlingJobResponse,
    summary="Get crawling job status",
    description="Returns the current status and result_data (if completed) for a crawling job.",
)
async def get_crawling_job_status(
    job_id: str,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> CrawlingJobResponse:
    """Retrieve status (and results) for an existing crawling job."""
    result = await db.execute(
        select(CrawlingJob).where(CrawlingJob.id == job_id)
    )
    job = result.scalar_one_or_none()

    if job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Crawling job '{job_id}' not found",
        )

    return CrawlingJobResponse.model_validate(job)
