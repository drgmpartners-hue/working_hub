"""Retirement Profiles API - CRUD for customer retirement planning profiles."""
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.core.deps import CurrentUser, get_current_user
from app.models.customer_retirement_profile import CustomerRetirementProfile
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
    """현재 로그인 사용자가 접근 가능한 은퇴 설계 프로필 목록 반환.

    일반 사용자는 본인 프로필만, 슈퍼유저는 전체 목록을 반환합니다.
    """
    if current_user.is_superuser:
        result = await db.execute(select(CustomerRetirementProfile))
    else:
        result = await db.execute(
            select(CustomerRetirementProfile).where(
                CustomerRetirementProfile.customer_id == current_user.id
            )
        )
    return result.scalars().all()


@router.get("/{customer_id}", response_model=CustomerRetirementProfileResponse)
async def get_retirement_profile(
    customer_id: str,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """특정 고객의 은퇴 설계 프로필 조회."""
    result = await db.execute(
        select(CustomerRetirementProfile).where(
            CustomerRetirementProfile.customer_id == customer_id
        )
    )
    profile = result.scalar_one_or_none()

    if not profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="은퇴 설계 프로필을 찾을 수 없습니다.",
        )

    # 본인 또는 슈퍼유저만 접근 가능
    if not current_user.is_superuser and profile.customer_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="접근 권한이 없습니다.",
        )

    return profile


@router.post("", response_model=CustomerRetirementProfileResponse, status_code=status.HTTP_201_CREATED)
async def create_retirement_profile(
    data: CustomerRetirementProfileCreate,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """현재 로그인 사용자의 은퇴 설계 프로필 생성.

    이미 프로필이 존재하면 409 Conflict를 반환합니다.
    """
    existing = await db.execute(
        select(CustomerRetirementProfile).where(
            CustomerRetirementProfile.customer_id == current_user.id
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="이미 은퇴 설계 프로필이 존재합니다. PUT으로 수정하세요.",
        )

    profile = CustomerRetirementProfile(
        customer_id=current_user.id,
        **data.model_dump(),
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
    """특정 고객의 은퇴 설계 프로필 수정."""
    result = await db.execute(
        select(CustomerRetirementProfile).where(
            CustomerRetirementProfile.customer_id == customer_id
        )
    )
    profile = result.scalar_one_or_none()

    if not profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="은퇴 설계 프로필을 찾을 수 없습니다.",
        )

    # 본인 또는 슈퍼유저만 수정 가능
    if not current_user.is_superuser and profile.customer_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="접근 권한이 없습니다.",
        )

    update_fields = data.model_dump(exclude_unset=True)
    for field, value in update_fields.items():
        setattr(profile, field, value)

    await db.commit()
    await db.refresh(profile)
    return profile
