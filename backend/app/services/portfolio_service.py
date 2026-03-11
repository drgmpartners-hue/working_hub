"""Portfolio analysis and portfolio item service layer."""
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.portfolio import PortfolioAnalysis, PortfolioItem
from app.schemas.portfolio import (
    PortfolioAnalysisCreate,
    PortfolioAnalysisUpdate,
    PortfolioItemUpdate,
)


async def create_analysis(
    db: AsyncSession,
    user_id: str,
    data: PortfolioAnalysisCreate,
) -> PortfolioAnalysis:
    """Create a new portfolio analysis record."""
    analysis = PortfolioAnalysis(
        user_id=user_id,
        data_source=data.data_source,
        raw_data=data.raw_data,
        status="pending",
    )
    db.add(analysis)
    await db.commit()
    await db.refresh(analysis)
    return analysis


async def get_analyses(
    db: AsyncSession,
    user_id: str,
) -> list[PortfolioAnalysis]:
    """Return all portfolio analyses owned by the given user."""
    result = await db.execute(
        select(PortfolioAnalysis)
        .where(PortfolioAnalysis.user_id == user_id)
        .order_by(PortfolioAnalysis.created_at.desc())
    )
    return list(result.scalars().all())


async def get_analysis(
    db: AsyncSession,
    user_id: str,
    analysis_id: str,
) -> Optional[PortfolioAnalysis]:
    """Return a single portfolio analysis owned by the given user, or None."""
    result = await db.execute(
        select(PortfolioAnalysis).where(
            PortfolioAnalysis.id == analysis_id,
            PortfolioAnalysis.user_id == user_id,
        )
    )
    return result.scalar_one_or_none()


async def update_analysis(
    db: AsyncSession,
    user_id: str,
    analysis_id: str,
    data: PortfolioAnalysisUpdate,
) -> Optional[PortfolioAnalysis]:
    """Update an existing portfolio analysis. Returns None if not found."""
    analysis = await get_analysis(db, user_id, analysis_id)
    if analysis is None:
        return None

    update_fields = data.model_dump(exclude_unset=True)
    for field, value in update_fields.items():
        setattr(analysis, field, value)

    await db.commit()
    await db.refresh(analysis)
    return analysis


async def get_items(
    db: AsyncSession,
    analysis_id: str,
) -> list[PortfolioItem]:
    """Return all portfolio items belonging to the given analysis."""
    result = await db.execute(
        select(PortfolioItem).where(PortfolioItem.analysis_id == analysis_id)
    )
    return list(result.scalars().all())


async def update_item(
    db: AsyncSession,
    analysis_id: str,
    item_id: str,
    data: PortfolioItemUpdate,
) -> Optional[PortfolioItem]:
    """Update a portfolio item. Returns None if not found."""
    result = await db.execute(
        select(PortfolioItem).where(
            PortfolioItem.id == item_id,
            PortfolioItem.analysis_id == analysis_id,
        )
    )
    item = result.scalar_one_or_none()
    if item is None:
        return None

    update_fields = data.model_dump(exclude_unset=True)
    for field, value in update_fields.items():
        setattr(item, field, value)

    await db.commit()
    await db.refresh(item)
    return item
