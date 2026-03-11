"""Commission calculation and result endpoints."""
from __future__ import annotations

import os
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.responses import FileResponse

from app.core.deps import CurrentUser
from app.db.session import get_db
from app.schemas.commission import (
    CommissionCalculationCreate,
    CommissionCalculationList,
    CommissionCalculationResponse,
    CommissionResultList,
    CommissionResultResponse,
)
from app.services import commission_service, pdf_service

router = APIRouter(prefix="/commissions", tags=["commissions"])


# ---------------------------------------------------------------------------
# POST /commissions  — create a new calculation
# ---------------------------------------------------------------------------

@router.post(
    "",
    response_model=CommissionCalculationResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a commission calculation",
)
async def create_commission_calculation(
    payload: CommissionCalculationCreate,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> CommissionCalculationResponse:
    """Run the commission calculation for the provided input data and persist
    the results.  Requires a valid Bearer token.
    """
    calculation = await commission_service.create_calculation(
        db=db,
        user_id=current_user.id,
        data=payload,
    )
    return CommissionCalculationResponse.model_validate(calculation)


# ---------------------------------------------------------------------------
# GET /commissions  — list all calculations for current user
# ---------------------------------------------------------------------------

@router.get(
    "",
    response_model=CommissionCalculationList,
    summary="List commission calculations for current user",
)
async def list_commission_calculations(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> CommissionCalculationList:
    """Return all commission calculations owned by the authenticated user."""
    calculations = await commission_service.get_calculations(
        db=db,
        user_id=current_user.id,
    )
    items = [
        CommissionCalculationResponse.model_validate(c) for c in calculations
    ]
    return CommissionCalculationList(items=items, total=len(items))


# ---------------------------------------------------------------------------
# GET /commissions/{calc_id}  — get a single calculation
# ---------------------------------------------------------------------------

@router.get(
    "/{calc_id}",
    response_model=CommissionCalculationResponse,
    summary="Get a commission calculation by ID",
)
async def get_commission_calculation(
    calc_id: str,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> CommissionCalculationResponse:
    """Return a single commission calculation if it belongs to the authenticated user."""
    calculation = await commission_service.get_calculation(
        db=db,
        user_id=current_user.id,
        calc_id=calc_id,
    )
    if calculation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Calculation '{calc_id}' not found",
        )
    return CommissionCalculationResponse.model_validate(calculation)


# ---------------------------------------------------------------------------
# GET /commissions/{calc_id}/results  — list results for a calculation
# ---------------------------------------------------------------------------

@router.get(
    "/{calc_id}/results",
    response_model=CommissionResultList,
    summary="List results for a commission calculation",
)
async def list_commission_results(
    calc_id: str,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> CommissionResultList:
    """Return all per-employee commission results for the specified calculation.

    The calculation must belong to the authenticated user.
    """
    # Verify ownership
    calculation = await commission_service.get_calculation(
        db=db,
        user_id=current_user.id,
        calc_id=calc_id,
    )
    if calculation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Calculation '{calc_id}' not found",
        )

    results = await commission_service.get_results(db=db, calc_id=calc_id)
    items = [CommissionResultResponse.model_validate(r) for r in results]
    return CommissionResultList(items=items, total=len(items))


# ---------------------------------------------------------------------------
# GET /commissions/{calc_id}/results/{result_id}/download — download PDF
# ---------------------------------------------------------------------------

@router.get(
    "/{calc_id}/results/{result_id}/download",
    summary="Download the PDF report for a commission result",
    response_class=FileResponse,
)
async def download_commission_result_pdf(
    calc_id: str,
    result_id: str,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> FileResponse:
    """Generate (or return cached) PDF for a single commission result.

    The parent calculation must belong to the authenticated user.
    """
    # Verify ownership via the parent calculation
    calculation = await commission_service.get_calculation(
        db=db,
        user_id=current_user.id,
        calc_id=calc_id,
    )
    if calculation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Calculation '{calc_id}' not found",
        )

    result = await commission_service.get_result(db=db, result_id=result_id)
    if result is None or result.calculation_id != calc_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Result '{result_id}' not found",
        )

    # Use cached path if it already exists, otherwise generate
    if result.report_file_path and os.path.isfile(result.report_file_path):
        file_path = result.report_file_path
    else:
        file_path = pdf_service.generate_commission_pdf(result)

        # Persist the generated path so subsequent requests skip regeneration
        result.report_file_path = file_path
        db.add(result)
        await db.commit()

    employee_safe = result.employee_name.replace(" ", "_")
    filename = f"commission_{employee_safe}_{result.id[:8]}.pdf"

    return FileResponse(
        path=file_path,
        media_type="application/pdf",
        filename=filename,
    )
