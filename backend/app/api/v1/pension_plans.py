"""Pension plans API endpoints.

Routes
------
POST /retirement/pension/calculate      - 연금 계산 + DB 저장
GET  /retirement/pension/{customer_id}  - 고객별 연금 계획 조회
PUT  /retirement/pension/{pension_plan_id} - 연금 계획 수정
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.customer_retirement_profile import CustomerRetirementProfile
from app.models.pension_plan import PensionPlan
from app.models.retirement_plan import RetirementPlan
from app.models.user import User
from app.schemas.pension_plan import (
    PensionCalculateRequest,
    PensionPlanResponse,
    PensionPlanUpdate,
)
from app.services.pension_calc import PensionCalcService

router = APIRouter(prefix="/retirement/pension", tags=["pension-plans"])


# ---------------------------------------------------------------------------
# POST /retirement/pension/calculate
# ---------------------------------------------------------------------------


@router.post(
    "/calculate",
    response_model=PensionPlanResponse,
    status_code=status.HTTP_201_CREATED,
    summary="연금 계산 및 저장 (종신형/확정형/상속형)",
)
async def calculate_and_save_pension(
    payload: PensionCalculateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """customer_id(profile_id)와 pension_type을 받아 연금 계산 후 DB에 저장.

    - customer_id: customer_retirement_profiles.id (UUID String)
    - pension_type: lifetime | fixed | inheritance

    은퇴자금은 retirement_plans 테이블에서 최신 플랜의 yearly_projections 마지막 값 사용.
    retirement_age는 CustomerRetirementProfile.desired_retirement_age 사용.
    """
    # 1. 프로필 조회
    profile: CustomerRetirementProfile | None = await db.get(
        CustomerRetirementProfile, payload.customer_id
    )
    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"CustomerRetirementProfile '{payload.customer_id}' not found",
        )

    # 2. 최신 retirement_plan 조회 (yearly_projections 활용)
    stmt = (
        select(RetirementPlan)
        .where(RetirementPlan.profile_id == payload.customer_id)
        .order_by(RetirementPlan.created_at.desc())
        .limit(1)
    )
    result = await db.execute(stmt)
    latest_plan: RetirementPlan | None = result.scalar_one_or_none()

    accumulation_projections: list[dict] = []
    retirement_fund: float = 0.0

    if latest_plan and latest_plan.yearly_projections:
        projections = latest_plan.yearly_projections
        accumulation_projections = projections
        # 은퇴자금 = yearly_projections 중 은퇴 나이 시점의 evaluation
        retirement_age = profile.desired_retirement_age
        # 은퇴 나이 시점 이전 마지막 값 찾기
        retirement_entry = None
        for entry in projections:
            if entry.get("age", 0) <= retirement_age:
                retirement_entry = entry
        if retirement_entry:
            retirement_fund = float(retirement_entry.get("evaluation", 0))
        else:
            # fallback: 첫 번째 항목
            retirement_fund = float(projections[0].get("evaluation", 0))
    elif latest_plan and latest_plan.target_retirement_fund:
        retirement_fund = float(latest_plan.target_retirement_fund)
        retirement_age = profile.desired_retirement_age
    else:
        # target_retirement_fund fallback (원 단위 → 만원 변환)
        retirement_fund = float(profile.target_retirement_fund) / 10000
        retirement_age = profile.desired_retirement_age

    # 3. 연금 계산
    calc_result = PensionCalcService.calculate(
        retirement_fund=retirement_fund,
        retirement_age=retirement_age,
        pension_type=payload.pension_type,
        accumulation_projections=accumulation_projections,
    )

    # 4. accumulation_summary 생성
    accumulation_summary = {
        "retirement_fund": retirement_fund,
        "retirement_age": retirement_age,
        "pension_type": payload.pension_type,
        "monthly_amount": calc_result.get("monthly_amount"),
    }
    if payload.pension_type == "lifetime":
        accumulation_summary["life_expectancy_years"] = calc_result.get("life_expectancy_years")
    elif payload.pension_type == "fixed":
        accumulation_summary["fixed_period_years"] = calc_result.get("fixed_period_years")
    elif payload.pension_type == "inheritance":
        accumulation_summary["annual_rate"] = calc_result.get("annual_rate")

    # 5. DB 저장 (기존 동일 pension_type 있으면 UPDATE, 없으면 INSERT)
    existing_stmt = (
        select(PensionPlan)
        .where(
            PensionPlan.profile_id == payload.customer_id,
            PensionPlan.pension_type == payload.pension_type,
        )
        .limit(1)
    )
    existing_result = await db.execute(existing_stmt)
    existing: PensionPlan | None = existing_result.scalar_one_or_none()

    if existing:
        existing.accumulation_summary = accumulation_summary
        existing.distribution_plan = calc_result.get("distribution_plan")
        existing.combined_graph_data = calc_result.get("combined_graph_data")
        pension_plan = existing
    else:
        pension_plan = PensionPlan(
            profile_id=payload.customer_id,
            pension_type=payload.pension_type,
            accumulation_summary=accumulation_summary,
            distribution_plan=calc_result.get("distribution_plan"),
            combined_graph_data=calc_result.get("combined_graph_data"),
        )
        db.add(pension_plan)

    await db.commit()
    await db.refresh(pension_plan)
    return pension_plan


# ---------------------------------------------------------------------------
# GET /retirement/pension/{customer_id}
# ---------------------------------------------------------------------------


@router.get(
    "/{customer_id}",
    response_model=list[PensionPlanResponse],
    summary="고객별 연금 계획 목록 조회",
)
async def get_pension_plans(
    customer_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """customer_id(profile_id)에 해당하는 모든 연금 계획 반환."""
    stmt = select(PensionPlan).where(PensionPlan.profile_id == customer_id)
    result = await db.execute(stmt)
    plans = result.scalars().all()
    return plans


# ---------------------------------------------------------------------------
# PUT /retirement/pension/{pension_plan_id}
# ---------------------------------------------------------------------------


@router.put(
    "/{pension_plan_id}",
    response_model=PensionPlanResponse,
    summary="연금 계획 수정",
)
async def update_pension_plan(
    pension_plan_id: int,
    payload: PensionPlanUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """연금 계획 필드 부분 수정."""
    plan: PensionPlan | None = await db.get(PensionPlan, pension_plan_id)
    if plan is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"PensionPlan {pension_plan_id} not found",
        )

    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(plan, field, value)

    await db.commit()
    await db.refresh(plan)
    return plan
