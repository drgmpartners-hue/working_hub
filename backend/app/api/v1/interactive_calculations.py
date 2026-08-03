"""Interactive Calculations API.

Routes
------
POST /retirement/simulation/interactive   - 계산 실행 + 저장
GET  /retirement/interactive/{customer_id} - 저장된 계산 결과 조회
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.db.session import get_db
from app.models.customer_retirement_profile import CustomerRetirementProfile
from app.models.interactive_calculation import InteractiveCalculation
from app.models.investment_record import InvestmentRecord
from app.models.retirement_plan import RetirementPlan
from app.schemas.interactive_calculation import (
    InteractiveCalcRequest,
    InteractiveCalcResponse,
)
from app.services.interactive_calc import InteractiveCalcService

router = APIRouter(prefix="/retirement", tags=["retirement-interactive"])


async def _get_profile_by_customer_or_404(
    customer_id: str,
    db: AsyncSession,
    user_id: str | None = None,
) -> CustomerRetirementProfile:
    """고객 ID로 은퇴 설계 프로필 조회 헬퍼.

    user_id가 주어지면 해당 담당자의 고객인지 소유권을 검증한다(IDOR 방지).
    """
    from app.models.client import Client  # noqa: PLC0415

    query = select(CustomerRetirementProfile).where(
        CustomerRetirementProfile.customer_id == customer_id
    )
    if user_id is not None:
        query = query.join(
            Client, Client.id == CustomerRetirementProfile.customer_id
        ).where(Client.user_id == user_id)
    result = await db.execute(query.limit(1))
    profile = result.scalars().first()
    if not profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="은퇴 설계 프로필을 찾을 수 없습니다.",
        )
    return profile


# ---------------------------------------------------------------------------
# POST /retirement/simulation/interactive
# ---------------------------------------------------------------------------

@router.post(
    "/simulation/interactive",
    response_model=InteractiveCalcResponse,
    status_code=status.HTTP_201_CREATED,
    summary="인터랙티브 계산 실행 + 저장",
)
async def run_interactive_calculation(
    payload: InteractiveCalcRequest,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = None,
):
    """계획 대비 실제 비교 계산을 실행하고 결과를 저장합니다.

    - 3번탭(retirement_plans)의 yearly_projections를 계획 데이터로 사용
    - 2번탭(investment_records)에서 연간 투자 흐름을 실제 데이터로 사용
    - 이격률 계산 후 수정 예측 시뮬레이션 수행
    """
    # 1. 고객 프로필 조회 (담당자 소유권 검증 포함)
    profile = await _get_profile_by_customer_or_404(
        payload.customer_id, db, user_id=current_user.id
    )

    # 2. retirement_plan 조회 (가장 최근 플랜 사용)
    # limit(1): 플랜이 2건 이상이어도 MultipleResultsFound 500 방지
    result = await db.execute(
        select(RetirementPlan)
        .where(RetirementPlan.profile_id == profile.id)
        .order_by(RetirementPlan.created_at.desc())
        .limit(1)
    )
    plan = result.scalars().first()
    if not plan:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="은퇴 설계 플랜이 없습니다. 먼저 시뮬레이션 플랜을 생성해주세요.",
        )

    yearly_projections = plan.yearly_projections or []
    annual_return_rate = float(plan.annual_return_rate)
    target_pension_amount = float(plan.target_pension_amount or 0)

    # 3. 투자 기록 조회
    records_result = await db.execute(
        select(InvestmentRecord).where(
            InvestmentRecord.profile_id == profile.id
        )
    )
    records_orm = records_result.scalars().all()

    # ORM 객체를 dict로 변환
    records = [
        {
            "record_type": r.record_type,
            "investment_amount": r.investment_amount,
            "evaluation_amount": r.evaluation_amount,
            "status": r.status,
            "start_date": r.start_date,
            "end_date": r.end_date,
            "product_name": r.product_name,
        }
        for r in records_orm
    ]

    # 4. 인터랙티브 계산 실행
    calc_result = InteractiveCalcService.run(
        records=records,
        plan_year=payload.plan_year,
        yearly_projections=yearly_projections,
        annual_return_rate=annual_return_rate,
        target_pension_amount=target_pension_amount,
    )

    # 5. 결과 저장 (기존 같은 연도 결과 있으면 업데이트)
    existing_result = await db.execute(
        select(InteractiveCalculation).where(
            InteractiveCalculation.profile_id == profile.id,
            InteractiveCalculation.plan_year == payload.plan_year,
        )
    )
    existing = existing_result.scalar_one_or_none()

    if existing:
        existing.actual_data = calc_result["actual_data"]
        existing.projected_data = calc_result["projected_data"]
        existing.deviation_rate = calc_result["deviation_rate"]
        await db.commit()
        await db.refresh(existing)
        return existing
    else:
        new_calc = InteractiveCalculation(
            profile_id=profile.id,
            plan_year=payload.plan_year,
            actual_data=calc_result["actual_data"],
            projected_data=calc_result["projected_data"],
            deviation_rate=calc_result["deviation_rate"],
        )
        db.add(new_calc)
        await db.commit()
        await db.refresh(new_calc)
        return new_calc


# ---------------------------------------------------------------------------
# GET /retirement/interactive/{customer_id}
# ---------------------------------------------------------------------------

@router.get(
    "/interactive/{customer_id}",
    response_model=list[InteractiveCalcResponse],
    summary="저장된 인터랙티브 계산 결과 목록 조회",
)
async def list_interactive_calculations(
    customer_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = None,
):
    """고객의 저장된 인터랙티브 계산 결과를 모두 조회합니다."""
    profile = await _get_profile_by_customer_or_404(
        customer_id, db, user_id=current_user.id
    )

    result = await db.execute(
        select(InteractiveCalculation)
        .where(InteractiveCalculation.profile_id == profile.id)
        .order_by(InteractiveCalculation.plan_year.desc())
    )
    calculations = result.scalars().all()
    return calculations
