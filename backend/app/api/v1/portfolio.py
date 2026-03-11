"""Portfolio analysis and portfolio item endpoints."""
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.deps import CurrentUser
from app.db.session import get_db
from app.schemas.portfolio import (
    PortfolioAnalysisCreate,
    PortfolioAnalysisUpdate,
    PortfolioAnalysisResponse,
    PortfolioItemResponse,
    PortfolioItemUpdate,
)
from app.services import portfolio_service

router = APIRouter(prefix="/portfolios", tags=["portfolios"])


# ---------------------------------------------------------------------------
# Portfolio Analyses
# ---------------------------------------------------------------------------


@router.post(
    "",
    response_model=PortfolioAnalysisResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a portfolio analysis",
)
async def create_analysis(
    body: PortfolioAnalysisCreate,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> PortfolioAnalysisResponse:
    """Create a new portfolio analysis record for the authenticated user."""
    analysis = await portfolio_service.create_analysis(db, current_user.id, body)
    return PortfolioAnalysisResponse.model_validate(analysis)


@router.get(
    "",
    response_model=list[PortfolioAnalysisResponse],
    summary="List portfolio analyses",
)
async def list_analyses(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[PortfolioAnalysisResponse]:
    """Return all portfolio analyses owned by the authenticated user."""
    analyses = await portfolio_service.get_analyses(db, current_user.id)
    return [PortfolioAnalysisResponse.model_validate(a) for a in analyses]


@router.get(
    "/{analysis_id}",
    response_model=PortfolioAnalysisResponse,
    summary="Get portfolio analysis detail",
)
async def get_analysis(
    analysis_id: str,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> PortfolioAnalysisResponse:
    """Return a single portfolio analysis owned by the authenticated user."""
    analysis = await portfolio_service.get_analysis(db, current_user.id, analysis_id)
    if analysis is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Portfolio analysis '{analysis_id}' not found.",
        )
    return PortfolioAnalysisResponse.model_validate(analysis)


@router.put(
    "/{analysis_id}",
    response_model=PortfolioAnalysisResponse,
    summary="Update portfolio analysis",
)
async def update_analysis(
    analysis_id: str,
    body: PortfolioAnalysisUpdate,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> PortfolioAnalysisResponse:
    """Update fields on an existing portfolio analysis owned by the authenticated user."""
    analysis = await portfolio_service.update_analysis(
        db, current_user.id, analysis_id, body
    )
    if analysis is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Portfolio analysis '{analysis_id}' not found.",
        )
    return PortfolioAnalysisResponse.model_validate(analysis)


# ---------------------------------------------------------------------------
# Portfolio Items
# ---------------------------------------------------------------------------


@router.get(
    "/{analysis_id}/items",
    response_model=list[PortfolioItemResponse],
    summary="List portfolio items",
)
async def list_items(
    analysis_id: str,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[PortfolioItemResponse]:
    """Return all portfolio items for the given analysis.

    The analysis must belong to the authenticated user.
    """
    # Verify the analysis belongs to the current user
    analysis = await portfolio_service.get_analysis(db, current_user.id, analysis_id)
    if analysis is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Portfolio analysis '{analysis_id}' not found.",
        )
    items = await portfolio_service.get_items(db, analysis_id)
    return [PortfolioItemResponse.model_validate(i) for i in items]


@router.put(
    "/{analysis_id}/items/{item_id}",
    response_model=PortfolioItemResponse,
    summary="Update a portfolio item",
)
async def update_item(
    analysis_id: str,
    item_id: str,
    body: PortfolioItemUpdate,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> PortfolioItemResponse:
    """Update a portfolio item.

    The parent analysis must belong to the authenticated user.
    """
    # Verify the analysis belongs to the current user
    analysis = await portfolio_service.get_analysis(db, current_user.id, analysis_id)
    if analysis is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Portfolio analysis '{analysis_id}' not found.",
        )
    item = await portfolio_service.update_item(db, analysis_id, item_id, body)
    if item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Portfolio item '{item_id}' not found.",
        )
    return PortfolioItemResponse.model_validate(item)
