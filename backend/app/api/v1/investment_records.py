"""Investment Records API - CRUD + annual flow for retirement planning."""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.core.deps import CurrentUser
from app.models.investment_record import InvestmentRecord
from app.models.customer_retirement_profile import CustomerRetirementProfile
from app.schemas.investment_record import (
    InvestmentRecordCreate,
    InvestmentRecordUpdate,
    InvestmentRecordResponse,
    AnnualFlowResponse,
)
from app.services.annual_flow_calc import calculate_return_rate, calculate_annual_flow

router = APIRouter(prefix="/retirement/investment-records", tags=["retirement"])


async def _get_profile_or_404(
    profile_id: str,
    db: AsyncSession,
) -> CustomerRetirementProfile:
    """프로필 존재 여부 확인 헬퍼."""
    result = await db.execute(
        select(CustomerRetirementProfile).where(
            CustomerRetirementProfile.id == profile_id
        )
    )
    profile = result.scalar_one_or_none()
    if not profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="은퇴 설계 프로필을 찾을 수 없습니다.",
        )
    return profile


async def _get_record_or_404(
    record_id: int,
    db: AsyncSession,
) -> InvestmentRecord:
    """투자기록 존재 여부 확인 헬퍼."""
    result = await db.execute(
        select(InvestmentRecord).where(InvestmentRecord.id == record_id)
    )
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="투자기록을 찾을 수 없습니다.",
        )
    return record


# ---------------------------------------------------------------------------
# GET /api/v1/retirement/investment-records/annual-flow/{customer_id}/{year}
# 반드시 CRUD 엔드포인트보다 먼저 등록해야 path 충돌 방지
# ---------------------------------------------------------------------------

@router.get(
    "/annual-flow/{customer_id}/{year}",
    response_model=AnnualFlowResponse,
    summary="연간 투자흐름표 조회",
)
async def get_annual_flow(
    customer_id: str,
    year: int,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """고객의 연간 투자흐름표를 반환합니다.

    해당 연도(start_date 기준)의 투자기록을 집계하여 반환합니다.
    """
    # 고객의 은퇴 프로필 조회
    profile_result = await db.execute(
        select(CustomerRetirementProfile).where(
            CustomerRetirementProfile.customer_id == customer_id
        )
    )
    profile = profile_result.scalar_one_or_none()

    if not profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="은퇴 설계 프로필을 찾을 수 없습니다.",
        )

    # 권한 확인: 본인 또는 슈퍼유저
    if not current_user.is_superuser and profile.customer_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="접근 권한이 없습니다.",
        )

    # 해당 프로필의 투자기록 전체 조회 (서비스에서 연도 필터링)
    records_result = await db.execute(
        select(InvestmentRecord).where(
            InvestmentRecord.profile_id == profile.id
        )
    )
    records = records_result.scalars().all()

    # dict로 변환하여 서비스에 전달
    records_dict = [
        {
            "record_type": r.record_type,
            "investment_amount": r.investment_amount,
            "evaluation_amount": r.evaluation_amount,
            "status": r.status,
            "start_date": r.start_date,
            "end_date": r.end_date,
        }
        for r in records
    ]

    flow = calculate_annual_flow(records=records_dict, year=year)
    return flow


# ---------------------------------------------------------------------------
# GET /api/v1/retirement/investment-records
# ---------------------------------------------------------------------------

@router.get(
    "",
    response_model=List[InvestmentRecordResponse],
    summary="투자기록 목록 조회",
)
async def list_investment_records(
    customer_id: Optional[str] = Query(None, description="고객 user ID"),
    year: Optional[int] = Query(None, description="조회 연도 (start_date 기준)"),
    status_filter: Optional[str] = Query(None, alias="status", description="상태 필터: ing/exit/deposit"),
    current_user: CurrentUser = None,
    db: AsyncSession = Depends(get_db),
):
    """투자기록 목록 조회. customer_id, year, status 필터 지원."""
    query = select(InvestmentRecord)

    if customer_id:
        # customer_id -> profile_id 변환
        profile_result = await db.execute(
            select(CustomerRetirementProfile).where(
                CustomerRetirementProfile.customer_id == customer_id
            )
        )
        profile = profile_result.scalar_one_or_none()
        if not profile:
            return []

        # 권한 확인
        if not current_user.is_superuser and profile.customer_id != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="접근 권한이 없습니다.",
            )

        query = query.where(InvestmentRecord.profile_id == profile.id)
    elif not current_user.is_superuser:
        # customer_id 없이 조회하는 경우 본인 기록만
        profile_result = await db.execute(
            select(CustomerRetirementProfile).where(
                CustomerRetirementProfile.customer_id == current_user.id
            )
        )
        profile = profile_result.scalar_one_or_none()
        if not profile:
            return []
        query = query.where(InvestmentRecord.profile_id == profile.id)

    if year:
        from sqlalchemy import extract
        query = query.where(
            extract("year", InvestmentRecord.start_date) == year
        )

    if status_filter:
        query = query.where(InvestmentRecord.status == status_filter)

    result = await db.execute(query)
    return result.scalars().all()


# ---------------------------------------------------------------------------
# POST /api/v1/retirement/investment-records
# ---------------------------------------------------------------------------

@router.post(
    "",
    response_model=InvestmentRecordResponse,
    status_code=status.HTTP_201_CREATED,
    summary="투자기록 생성",
)
async def create_investment_record(
    data: InvestmentRecordCreate,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """투자기록 생성.

    exit 상태인 경우 수익률을 자동 계산합니다.
    """
    # 프로필 소유자 확인
    profile = await _get_profile_or_404(data.profile_id, db)
    if not current_user.is_superuser and profile.customer_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="접근 권한이 없습니다.",
        )

    # 수익률 자동 계산
    return_rate = None
    if data.status == "exit":
        return_rate = calculate_return_rate(
            investment_amount=data.investment_amount,
            evaluation_amount=data.evaluation_amount,
        )

    record = InvestmentRecord(
        **data.model_dump(),
        return_rate=return_rate,
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)
    return record


# ---------------------------------------------------------------------------
# PUT /api/v1/retirement/investment-records/{id}
# ---------------------------------------------------------------------------

@router.put(
    "/{record_id}",
    response_model=InvestmentRecordResponse,
    summary="투자기록 수정",
)
async def update_investment_record(
    record_id: int,
    data: InvestmentRecordUpdate,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """투자기록 수정.

    exit 상태로 변경되거나 evaluation_amount가 수정되면 수익률을 재계산합니다.
    """
    record = await _get_record_or_404(record_id, db)

    # 프로필 소유자 확인
    profile = await _get_profile_or_404(record.profile_id, db)
    if not current_user.is_superuser and profile.customer_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="접근 권한이 없습니다.",
        )

    update_fields = data.model_dump(exclude_unset=True)
    for field, value in update_fields.items():
        setattr(record, field, value)

    # 수익률 재계산 (exit 상태인 경우)
    final_status = update_fields.get("status", record.status)
    final_investment = update_fields.get("investment_amount", record.investment_amount)
    final_evaluation = update_fields.get("evaluation_amount", record.evaluation_amount)

    if final_status == "exit":
        record.return_rate = calculate_return_rate(
            investment_amount=final_investment,
            evaluation_amount=final_evaluation,
        )
    else:
        record.return_rate = None

    await db.commit()
    await db.refresh(record)
    return record


# ---------------------------------------------------------------------------
# DELETE /api/v1/retirement/investment-records/{id}
# ---------------------------------------------------------------------------

@router.delete(
    "/{record_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="투자기록 삭제",
)
async def delete_investment_record(
    record_id: int,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """투자기록 삭제."""
    record = await _get_record_or_404(record_id, db)

    # 프로필 소유자 확인
    profile = await _get_profile_or_404(record.profile_id, db)
    if not current_user.is_superuser and profile.customer_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="접근 권한이 없습니다.",
        )

    await db.delete(record)
    await db.commit()
