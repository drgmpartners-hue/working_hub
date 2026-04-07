"""AI 은퇴설계 가이드 엔드포인트.

POST /api/v1/retirement/ai-guide
"""
from __future__ import annotations

from typing import Annotated, List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.core.deps import CurrentUser
from app.services.ai_retirement_guide import AIRetirementGuideService

router = APIRouter(prefix="/retirement", tags=["ai-retirement-guide"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class AIRetirementGuideRequest(BaseModel):
    """AI 은퇴 가이드 요청 body."""

    customer_id: str = Field(..., description="고객 ID")
    deviation_rate: float = Field(..., description="이격률 (%) - 음수면 계획 대비 부족")
    current_evaluation: float = Field(..., gt=0, description="현재 실제 평가액 (원)")
    plan_annual_savings: float = Field(..., ge=0, description="연간 적립액 계획 (원)")
    plan_return_rate: float = Field(..., ge=0, le=1, description="목표 수익률 (0.0~1.0, 예: 7% = 0.07)")
    remaining_years: int = Field(..., ge=0, description="은퇴까지 남은 년수")
    target_fund: float = Field(..., gt=0, description="목표 은퇴자금 (원)")


class AdjustmentItem(BaseModel):
    """단일 조정 방안."""

    type: str
    current: Optional[float] = None
    suggested: Optional[float] = None
    description: str


class AIRetirementGuideResponse(BaseModel):
    """AI 은퇴 가이드 응답."""

    adjustments: List[AdjustmentItem]
    ai_explanation: Optional[str] = None


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------


@router.post("/ai-guide", response_model=AIRetirementGuideResponse)
async def get_ai_retirement_guide(
    payload: AIRetirementGuideRequest,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AIRetirementGuideResponse:
    """AI 은퇴설계 가이드 생성.

    현재 이격률과 투자 데이터를 기반으로 복리 역산 3가지 방안을 계산하고
    AI가 각 방안의 타당성을 설명합니다.

    - 방안 1 (savings_adjustment): 적립액 조정 - PMT 역산
    - 방안 2 (return_rate_adjustment): 수익률 조정 - 이진탐색 역산
    - 방안 3 (period_adjustment): 기간 조정 - 달성 년수 계산

    AI 호출 실패 시 계산 기반 수치만 반환합니다 (graceful degradation).
    """
    svc = AIRetirementGuideService()
    result = await svc.run(
        current_evaluation=payload.current_evaluation,
        plan_annual_savings=payload.plan_annual_savings,
        plan_return_rate=payload.plan_return_rate,
        remaining_years=payload.remaining_years,
        target_fund=payload.target_fund,
        deviation_rate=payload.deviation_rate,
        db=db,
    )

    return AIRetirementGuideResponse(
        adjustments=[AdjustmentItem(**adj) for adj in result["adjustments"]],
        ai_explanation=result.get("ai_explanation"),
    )
