"""Retirement Profiles API - CRUD for customer retirement planning profiles."""
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.core.deps import CurrentUser, get_current_user
from app.models.customer_retirement_profile import CustomerRetirementProfile
from app.core.permissions import (
    assert_client,
    assert_profile_by_customer,
    scope_by_client_column,
)
from app.schemas.retirement import (
    CustomerRetirementProfileCreate,
    CustomerRetirementProfileUpdate,
    CustomerRetirementProfileResponse,
)

router = APIRouter(prefix="/retirement/profiles", tags=["retirement"])


@router.get("", response_model=List[CustomerRetirementProfileResponse])
async def list_retirement_profiles(
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """접근 가능한 은퇴 설계 프로필 목록. 대표는 전체, 매니저는 담당 고객 것만."""
    stmt = scope_by_client_column(
        select(CustomerRetirementProfile), CustomerRetirementProfile.customer_id, current_user
    )
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/{customer_id}", response_model=CustomerRetirementProfileResponse)
async def get_retirement_profile(
    customer_id: str,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """특정 고객의 은퇴 설계 프로필 조회 (권한 없으면 404)."""
    return await assert_profile_by_customer(db, current_user, customer_id)


@router.post("", response_model=CustomerRetirementProfileResponse, status_code=status.HTTP_201_CREATED)
async def create_retirement_profile(
    data: CustomerRetirementProfileCreate,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """현재 로그인 사용자의 은퇴 설계 프로필 생성.

    이미 프로필이 존재하면 409 Conflict를 반환합니다.
    """
    # customer_id 는 clients.id. 접근 가능한 고객이어야 한다 (아니면 404).
    if not data.customer_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="customer_id(고객 id)가 필요합니다.",
        )
    await assert_client(db, current_user, data.customer_id)
    cid = data.customer_id

    existing = await db.execute(
        select(CustomerRetirementProfile).where(
            CustomerRetirementProfile.customer_id == cid
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="이미 은퇴 설계 프로필이 존재합니다. PUT으로 수정하세요.",
        )

    create_data = data.model_dump(exclude={"customer_id"})
    profile = CustomerRetirementProfile(
        customer_id=cid,
        **create_data,
    )
    db.add(profile)
    await db.commit()
    await db.refresh(profile)
    return profile


@router.put("/{customer_id}", response_model=CustomerRetirementProfileResponse)
async def update_retirement_profile(
    customer_id: str,
    data: CustomerRetirementProfileUpdate,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """특정 고객의 은퇴 설계 프로필 수정 (권한 없으면 404)."""
    profile = await assert_profile_by_customer(db, current_user, customer_id)

    update_fields = data.model_dump(exclude_unset=True)
    for field, value in update_fields.items():
        setattr(profile, field, value)

    await db.commit()
    await db.refresh(profile)
    return profile
