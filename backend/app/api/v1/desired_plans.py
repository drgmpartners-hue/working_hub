"""Desired Plans API - 은퇴 희망 플랜 조회 / upsert / 계산.

GET  /api/v1/retirement/desired-plans/{customer_id}      → 희망 플랜 조회
PUT  /api/v1/retirement/desired-plans/{customer_id}      → 희망 플랜 upsert (계산 + 저장)
POST /api/v1/retirement/desired-plans/calculate          → 저장 없이 계산만
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.db.session import get_db
from app.models.customer_retirement_profile import CustomerRetirementProfile
from app.models.desired_plan import DesiredPlan
from app.schemas.desired_plan import (
    DesiredPlanCalculateRequest,
    DesiredPlanCalculateResponse,
    DesiredPlanResponse,
    DesiredPlanUpsert,
    SimulationRow,
)
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
    """로그인한 사용자는 모든 고객 프로필 접근 가능 (설계사가 고객 관리)."""
    pass


def _enrich_response(plan: DesiredPlan) -> DesiredPlanResponse:
    """ORM 객체 → DesiredPlanResponse 변환 (calculation_params에서 계산값 복원)."""
    params: dict = plan.calculation_params or {}

    return DesiredPlanResponse(
        id=plan.id,
        profile_id=plan.profile_id,
        # 기존 필수 필드 (하위 호환)
        monthly_desired_amount=plan.monthly_desired_amount,
        retirement_period_years=plan.retirement_period_years,
        # 신규 입력값 컬럼 (직접 반환)
        pension_period_years=plan.pension_period_years,
        current_value_monthly=plan.current_value_monthly,
        future_monthly_amount=plan.future_monthly_amount,
        inflation_rate=plan.inflation_rate,
        retirement_pension_rate=plan.retirement_pension_rate,
        desired_retirement_age=plan.desired_retirement_age,
        savings_period_years=plan.savings_period_years,
        holding_period_years=plan.holding_period_years,
        expected_return_rate=plan.expected_return_rate,
        annual_savings_amount=plan.annual_savings_amount,
        # 계산 결과 컬럼
        target_retirement_fund=plan.target_retirement_fund,
        required_lump_sum_new=plan.required_lump_sum_new,
        # 토글 상태
        use_inflation_input=plan.use_inflation_input,
        use_inflation_calc=plan.use_inflation_calc,
        # 시뮬레이션 컬럼
        simulation_monthly_savings=plan.simulation_monthly_savings,
        simulation_annual_lump_sum=plan.simulation_annual_lump_sum,
        simulation_total_lump_sum=plan.simulation_total_lump_sum,
        simulation_target_fund=plan.simulation_target_fund,
        plan_start_year=plan.plan_start_year,
        simulation_data=plan.simulation_data,
        # calculation_params 에서 복원 (기존 방식 호환)
        target_fund=params.get("target_fund"),
        target_fund_inflation=params.get("target_fund_inflation"),
        target_fund_no_inflation=params.get("target_fund_no_inflation"),
        required_holding=params.get("required_holding"),
        investment_years=params.get("investment_years"),
        holding_period=params.get("holding_period"),
        simulation_table=params.get("simulation_table"),
        # 하위 호환
        target_total_fund=plan.target_total_fund,
        required_lump_sum=plan.required_lump_sum,
        required_annual_savings=plan.required_annual_savings,
        calculation_params=params,
        created_at=plan.created_at,
        updated_at=plan.updated_at,
    )


@router.post("/calculate", response_model=DesiredPlanCalculateResponse)
async def calculate_desired_plan(
    data: DesiredPlanCalculateRequest,
) -> DesiredPlanCalculateResponse:
    """저장 없이 희망 플랜 계산만 수행.

    DB 저장 없이 입력값 기반으로 계산 결과를 즉시 반환합니다.
    프론트엔드 실시간 계산 미리보기에 사용합니다.
    로그인한 사용자만 접근 가능합니다.
    """
    try:
        calc = CompoundCalcService.calculate_all(
            monthly_desired_amount=data.monthly_desired_amount,
            retirement_age=data.retirement_age,
            current_age=data.current_age,
            retirement_period_years=data.retirement_period_years,
            savings_period=data.savings_period,
            annual_savings=data.annual_savings,
            inflation_rate=data.inflation_rate,
            pension_return_rate=data.pension_return_rate,
            expected_return_rate=data.expected_return_rate,
            with_inflation=data.with_inflation,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    return DesiredPlanCalculateResponse(
        investment_years=calc["investment_years"],
        holding_period=calc["holding_period"],
        future_monthly_amount=calc["future_monthly_amount"],
        target_fund_inflation=calc["target_fund_inflation"],
        target_fund_no_inflation=calc["target_fund_no_inflation"],
        target_fund=calc["target_fund"],
        required_holding=calc["required_holding"],
        required_holding_inflation=calc["required_holding_inflation"],
        required_holding_no_inflation=calc["required_holding_no_inflation"],
        simulation_table=[SimulationRow(**row) for row in calc["simulation_table"]],
        calculation_params=calc["calculation_params"],
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
    return _enrich_response(plan)


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
    - 엑셀 PV/FV 기반 계산이 자동 수행됩니다.
    - 신규 필드(시뮬레이션 편집값, 토글 상태 등) 모두 저장됩니다.
    """
    profile = await _get_profile_or_404(customer_id, db)
    _check_access(current_user, profile)

    # annual_rate → expected_return_rate 하위 호환 처리
    expected_return_rate = data.expected_return_rate or 0.07
    if data.annual_rate is not None:
        expected_return_rate = data.annual_rate

    # inflation_rate / pension_return_rate 기본값 처리
    inflation_rate = data.inflation_rate if data.inflation_rate is not None else 0.021
    pension_return_rate = data.pension_return_rate if data.pension_return_rate is not None else 0.05

    try:
        calc = CompoundCalcService.calculate_all(
            monthly_desired_amount=data.monthly_desired_amount,
            retirement_age=data.retirement_age,
            current_age=data.current_age,
            retirement_period_years=data.retirement_period_years,
            savings_period=data.savings_period,
            annual_savings=data.annual_savings,
            inflation_rate=inflation_rate,
            pension_return_rate=pension_return_rate,
            expected_return_rate=expected_return_rate,
            with_inflation=data.with_inflation,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    # investment_years = retirement_age - current_age
    investment_years = data.retirement_age - data.current_age
    holding_period = max(0, investment_years - data.savings_period)

    # calculation_params: 계산 결과 + 프론트엔드 추가 파라미터 병합
    merged_params: dict = {**calc["calculation_params"]}
    # 계산 결과 값도 함께 저장 (GET 시 복원용)
    merged_params.update({
        "future_monthly_amount": calc["future_monthly_amount"],
        "target_fund": calc["target_fund"],
        "target_fund_inflation": calc["target_fund_inflation"],
        "target_fund_no_inflation": calc["target_fund_no_inflation"],
        "required_holding": calc["required_holding"],
        "investment_years": calc["investment_years"],
        "holding_period": calc["holding_period"],
        "simulation_table": calc["simulation_table"],
    })
    if data.calculation_params:
        merged_params.update(data.calculation_params)

    # 시뮬레이션 데이터: 프론트에서 직접 전달된 경우 우선 사용
    sim_data = data.simulation_data if data.simulation_data is not None else calc["simulation_table"]

    # 기존 플랜 조회 (upsert)
    result = await db.execute(
        select(DesiredPlan)
        .where(DesiredPlan.profile_id == profile.id)
        .order_by(DesiredPlan.updated_at.desc())
        .limit(1)
    )
    plan = result.scalar_one_or_none()

    # 공통 필드값 딕셔너리
    plan_fields = dict(
        # 기존 필수 필드 (하위 호환)
        monthly_desired_amount=data.monthly_desired_amount,
        retirement_period_years=data.retirement_period_years,
        target_total_fund=calc["target_total_fund"],
        required_lump_sum=calc["required_lump_sum"],
        required_annual_savings=calc["required_annual_savings"],
        calculation_params=merged_params,
        # 신규 입력값 컬럼
        pension_period_years=data.retirement_period_years,
        current_value_monthly=data.current_value_monthly or data.monthly_desired_amount,
        future_monthly_amount=data.future_monthly_amount or calc["future_monthly_amount"],
        inflation_rate=inflation_rate,
        retirement_pension_rate=pension_return_rate,
        desired_retirement_age=data.desired_retirement_age or data.retirement_age,
        savings_period_years=data.savings_period_years or data.savings_period,
        holding_period_years=data.holding_period_years or holding_period,
        expected_return_rate=data.expected_return_rate if data.expected_return_rate is not None else expected_return_rate,
        annual_savings_amount=data.annual_savings_amount or data.annual_savings,
        # 계산 결과 컬럼
        target_retirement_fund=calc["target_fund"],
        required_lump_sum_new=calc["required_holding"],
        # 토글 상태
        use_inflation_input=data.use_inflation_input,
        use_inflation_calc=data.use_inflation_calc if data.use_inflation_calc is not None else data.with_inflation,
        # 시뮬레이션 컬럼
        simulation_monthly_savings=data.simulation_monthly_savings,
        simulation_annual_lump_sum=data.simulation_annual_lump_sum,
        simulation_total_lump_sum=data.simulation_total_lump_sum,
        simulation_target_fund=data.simulation_target_fund,
        plan_start_year=data.plan_start_year,
        simulation_data=sim_data,
    )

    if plan:
        for field, value in plan_fields.items():
            setattr(plan, field, value)
    else:
        plan = DesiredPlan(profile_id=profile.id, **plan_fields)
        db.add(plan)

    await db.commit()
    await db.refresh(plan)
    return _enrich_response(plan)


@router.patch("/{customer_id}/params")
async def update_calculation_params(
    customer_id: str,
    body: dict,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """calculation_params 부분 업데이트 (applied_years 등 자동 저장용)."""
    # 프로필 조회
    profile_result = await db.execute(
        select(CustomerRetirementProfile).where(
            CustomerRetirementProfile.customer_id == customer_id
        )
    )
    profile = profile_result.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="프로필을 찾을 수 없습니다.")

    # 플랜 조회
    result = await db.execute(
        select(DesiredPlan)
        .where(DesiredPlan.profile_id == profile.id)
        .order_by(DesiredPlan.updated_at.desc())
        .limit(1)
    )
    plan = result.scalar_one_or_none()
    if not plan:
        raise HTTPException(status_code=404, detail="플랜을 찾을 수 없습니다.")

    # calculation_params 병합
    params = plan.calculation_params or {}
    new_params = body.get("calculation_params", {})
    params.update(new_params)
    plan.calculation_params = params

    await db.commit()
    return {"status": "ok"}
