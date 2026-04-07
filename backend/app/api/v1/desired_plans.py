"""Desired Plans API - 은퇴 희망 플랜 조회 및 upsert.

GET  /api/v1/retirement/desired-plans/{customer_id}  → 희망 플랜 조회
PUT  /api/v1/retirement/desired-plans/{customer_id}  → 희망 플랜 upsert (복리 역산 자동 계산)
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.db.session import get_db
from app.models.customer_retirement_profile import CustomerRetirementProfile
from app.models.desired_plan import DesiredPlan
from app.schemas.desired_plan import DesiredPlanResponse, DesiredPlanUpsert
from app.services.compound_calc import CompoundCalcService

router = APIRouter(prefix="/retirement/desired-plans", tags=["retirement"])


async def _get_profile_or_404(
    customer_id: str,
    db: AsyncSession,
) -> CustomerRetirementProfile:
    """customer_id로 은퇴 설계 프로필을 조회하거나 404 반환."""
    result = await db.execute(
        select(CustomerRetirementProfile).where(
            CustomerRetirementProfile.customer_id == customer_id
        )
    )
    profile = result.scalar_one_or_none()
    if not profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="은퇴 설계 프로필을 찾을 수 없습니다. 먼저 프로필을 생성하세요.",
        )
    return profile


def _check_access(
    current_user: CurrentUser,
    profile: CustomerRetirementProfile,
) -> None:
    """본인 또는 슈퍼유저만 접근 가능."""
    if not current_user.is_superuser and profile.customer_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="접근 권한이 없습니다.",
        )


@router.get("/{customer_id}", response_model=DesiredPlanResponse)
async def get_desired_plan(
    customer_id: str,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> DesiredPlanResponse:
    """특정 고객의 은퇴 희망 플랜 조회.

    - 해당 고객의 은퇴 설계 프로필(customer_retirement_profiles)이 존재해야 합니다.
    - 플랜이 없으면 404를 반환합니다.
    """
    profile = await _get_profile_or_404(customer_id, db)
    _check_access(current_user, profile)

    result = await db.execute(
        select(DesiredPlan)
        .where(DesiredPlan.profile_id == profile.id)
        .order_by(DesiredPlan.updated_at.desc())
        .limit(1)
    )
    plan = result.scalar_one_or_none()

    if not plan:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="희망 플랜이 없습니다. PUT으로 먼저 생성하세요.",
        )
    return plan


@router.put("/{customer_id}", response_model=DesiredPlanResponse)
async def upsert_desired_plan(
    customer_id: str,
    data: DesiredPlanUpsert,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> DesiredPlanResponse:
    """특정 고객의 은퇴 희망 플랜 upsert (생성 또는 수정).

    - 은퇴 설계 프로필이 없으면 404.
    - 플랜이 이미 존재하면 업데이트, 없으면 생성.
    - 복리 역산 계산이 자동으로 수행됩니다.
    - years_to_retirement가 없으면 프로필의
      (desired_retirement_age - current_age)로 계산합니다.
    """
    profile = await _get_profile_or_404(customer_id, db)
    _check_access(current_user, profile)

    # years_to_retirement 결정
    years_to_retirement = data.years_to_retirement
    if years_to_retirement is None:
        years_to_retirement = max(
            0,
            profile.desired_retirement_age - profile.current_age,
        )

    # 복리 역산 계산
    calc = CompoundCalcService.calculate_all(
        monthly_desired_amount=data.monthly_desired_amount,
        retirement_period_years=data.retirement_period_years,
        years_to_retirement=years_to_retirement,
        annual_rate=data.annual_rate,
    )

    # 기존 플랜 조회 (upsert)
    result = await db.execute(
        select(DesiredPlan)
        .where(DesiredPlan.profile_id == profile.id)
        .order_by(DesiredPlan.updated_at.desc())
        .limit(1)
    )
    plan = result.scalar_one_or_none()

    if plan:
        # 업데이트
        plan.monthly_desired_amount = data.monthly_desired_amount
        plan.retirement_period_years = data.retirement_period_years
        plan.target_total_fund = int(calc["target_total_fund"])
        plan.required_lump_sum = int(calc["required_lump_sum"])
        plan.required_annual_savings = int(calc["required_annual_savings"])
        plan.calculation_params = calc["calculation_params"]
    else:
        # 신규 생성
        plan = DesiredPlan(
            profile_id=profile.id,
            monthly_desired_amount=data.monthly_desired_amount,
            retirement_period_years=data.retirement_period_years,
            target_total_fund=int(calc["target_total_fund"]),
            required_lump_sum=int(calc["required_lump_sum"]),
            required_annual_savings=int(calc["required_annual_savings"]),
            calculation_params=calc["calculation_params"],
        )
        db.add(plan)

    await db.commit()
    await db.refresh(plan)
    return plan
