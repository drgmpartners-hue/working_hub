"""Retirement plans API endpoints.

Routes
------
GET  /retirement/plans/{customer_id}     - List plans by customer profile
POST /retirement/plans                   - Create a new plan
PUT  /retirement/plans/{id}              - Update an existing plan
POST /retirement/simulation/calculate    - Run simulation (no DB write)
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.core.permissions import assert_profile, not_found, scope_by_profile_column
from app.db.session import get_db
from app.models.retirement_plan import RetirementPlan
from app.models.user import User
from app.schemas.retirement_plan import (
    RetirementPlanCreate,
    RetirementPlanResponse,
    RetirementPlanUpdate,
    SimulationInput,
    SimulationResult,
)
from app.services.retirement_simulation import RetirementSimulationService

router = APIRouter(prefix="/retirement", tags=["retirement-plans"])


# ---------------------------------------------------------------------------
# GET /retirement/plans/{customer_id}
# ---------------------------------------------------------------------------

@router.get(
    "/plans/{customer_id}",
    response_model=list[RetirementPlanResponse],
    summary="고객 프로필의 은퇴 설계 플랜 목록 조회",
)
async def list_retirement_plans(
    customer_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return all retirement plans for the given customer_retirement_profile id."""
    # 경로의 customer_id 는 customer_retirement_profiles.id 다 (이름만 customer_id).
    stmt = select(RetirementPlan).where(RetirementPlan.profile_id == customer_id)
    stmt = scope_by_profile_column(stmt, RetirementPlan.profile_id, current_user)
    result = await db.execute(stmt)
    plans = result.scalars().all()
    return plans


# ---------------------------------------------------------------------------
# POST /retirement/plans
# ---------------------------------------------------------------------------

@router.post(
    "/plans",
    response_model=RetirementPlanResponse,
    status_code=status.HTTP_201_CREATED,
    summary="은퇴 설계 플랜 생성",
)
async def create_retirement_plan(
    payload: RetirementPlanCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new retirement plan and optionally run initial simulation."""
    await assert_profile(db, current_user, payload.profile_id)
    plan = RetirementPlan(**payload.model_dump())

    # Auto-calculate yearly_projections if enough data is present
    if plan.annual_return_rate is not None:
        plan.yearly_projections = RetirementSimulationService.calculate(
            current_age=plan.current_age,
            annual_return_rate=float(plan.annual_return_rate),
            lump_sum_amount=plan.lump_sum_amount or 0,
            annual_savings=plan.annual_savings or 0,
            saving_period_years=plan.saving_period_years or 0,
            target_pension_amount=plan.target_pension_amount or 0,
        )

    db.add(plan)
    await db.commit()
    await db.refresh(plan)
    return plan


# ---------------------------------------------------------------------------
# PUT /retirement/plans/{id}
# ---------------------------------------------------------------------------

@router.put(
    "/plans/{plan_id}",
    response_model=RetirementPlanResponse,
    summary="은퇴 설계 플랜 수정",
)
async def update_retirement_plan(
    plan_id: int,
    payload: RetirementPlanUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update fields of an existing retirement plan."""
    stmt = scope_by_profile_column(
        select(RetirementPlan).where(RetirementPlan.id == plan_id),
        RetirementPlan.profile_id,
        current_user,
    )
    plan: RetirementPlan | None = (await db.execute(stmt)).scalar_one_or_none()
    if plan is None:
        raise not_found()

    update_data = payload.model_dump(exclude_unset=True)
    # 수정_tasks P1-23: 비울 수 없는 칸(나이·수익률·상속 고려)에 null 이 오면 무시(예전엔 DB 오류·float(None) 500)
    for f in ("current_age", "annual_return_rate", "inheritance_consideration"):
        if f in update_data and update_data[f] is None:
            update_data.pop(f)
    for field, value in update_data.items():
        setattr(plan, field, value)

    # Recalculate projections if any simulation-relevant fields changed
    simulation_fields = {
        "current_age",
        "annual_return_rate",
        "lump_sum_amount",
        "annual_savings",
        "saving_period_years",
        "target_pension_amount",
    }
    if simulation_fields & set(update_data.keys()):
        plan.yearly_projections = RetirementSimulationService.calculate(
            current_age=plan.current_age,
            annual_return_rate=float(plan.annual_return_rate),
            lump_sum_amount=plan.lump_sum_amount or 0,
            annual_savings=plan.annual_savings or 0,
            saving_period_years=plan.saving_period_years or 0,
            target_pension_amount=plan.target_pension_amount or 0,
        )

    await db.commit()
    await db.refresh(plan)
    return plan


# ---------------------------------------------------------------------------
# POST /retirement/simulation/calculate
# ---------------------------------------------------------------------------

@router.post(
    "/simulation/calculate",
    response_model=SimulationResult,
    summary="은퇴 시뮬레이션 계산 (DB 저장 없음)",
)
async def calculate_simulation(
    payload: SimulationInput,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Run the retirement simulation and return yearly projections (no DB write)."""
    projections = RetirementSimulationService.calculate(
        current_age=payload.current_age,
        annual_return_rate=payload.annual_return_rate,
        lump_sum_amount=payload.lump_sum_amount or 0,
        annual_savings=payload.annual_savings or 0,
        saving_period_years=payload.saving_period_years or 0,
        target_pension_amount=payload.target_pension_amount or 0,
    )
    return SimulationResult(yearly_projections=projections)
