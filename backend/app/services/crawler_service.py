"""Crawler service - stub implementation.

This module provides a placeholder crawling service. Real browser automation
(e.g. Playwright) will replace the asyncio.sleep stub in a future phase.
"""
import asyncio
import logging
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.db.session import AsyncSessionLocal
from app.models.crawling import CrawlingJob

logger = logging.getLogger(__name__)


async def run_crawling_job(job_id: str, source_type: str) -> None:
    """Execute a crawling job asynchronously.

    Opens its own database session so it can run safely in a FastAPI
    BackgroundTasks context (after the request session has been closed).

    Status flow: pending -> running -> completed | failed
    """
    async with AsyncSessionLocal() as db:
        try:
            # Transition: pending -> running
            result = await db.execute(
                select(CrawlingJob).where(CrawlingJob.id == job_id)
            )
            job = result.scalar_one_or_none()
            if job is None:
                logger.error("CrawlingJob %s not found", job_id)
                return

            job.status = "running"
            await db.commit()

            # --- STUB: simulate work with a short delay ---
            await asyncio.sleep(2)

            mock_result = _build_mock_result(source_type)

            # Transition: running -> completed
            job.status = "completed"
            job.result_data = mock_result
            await db.commit()
            logger.info("CrawlingJob %s completed", job_id)

        except Exception as exc:  # noqa: BLE001
            logger.exception("CrawlingJob %s failed: %s", job_id, exc)
            try:
                result = await db.execute(
                    select(CrawlingJob).where(CrawlingJob.id == job_id)
                )
                job = result.scalar_one_or_none()
                if job is not None:
                    job.status = "failed"
                    job.error_message = str(exc)
                    await db.commit()
            except Exception:  # noqa: BLE001
                logger.exception("Failed to persist error state for job %s", job_id)


def _build_mock_result(source_type: str) -> dict:
    """Return mock result data based on source_type."""
    if source_type == "securities_commission":
        return {
            "source": "securities_commission",
            "records": [
                {"fund_name": "Mock Fund A", "commission_rate": 0.015},
                {"fund_name": "Mock Fund B", "commission_rate": 0.012},
            ],
            "crawled_at": "2026-03-09T00:00:00Z",
        }
    if source_type == "irp_portfolio":
        return {
            "source": "irp_portfolio",
            "items": [
                {"product_name": "Mock IRP Product 1", "allocation": 0.5},
                {"product_name": "Mock IRP Product 2", "allocation": 0.5},
            ],
            "crawled_at": "2026-03-09T00:00:00Z",
        }
    return {
        "source": source_type,
        "raw": "stub result",
        "crawled_at": "2026-03-09T00:00:00Z",
    }
