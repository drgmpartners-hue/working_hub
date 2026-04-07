"""AI 은퇴설계 가이드 서비스.

복리 역산 3가지 방안 계산 + AI 설명 생성.

방안 1 - 적립액 조정: PMT 역산
  FV = PV*(1+r)^n + PMT*((1+r)^n - 1)/r
  PMT = (FV - PV*(1+r)^n) * r / ((1+r)^n - 1)

방안 2 - 수익률 조정: 이진탐색으로 필요 수익률 역산

방안 3 - 기간 조정: 반복 시뮬레이션으로 달성 년수 계산
"""
from __future__ import annotations

import logging
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ai_setting import AIAPISetting
from app.core.security import decrypt_api_key

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# AI API 호출 헬퍼 (provider별 분기)
# ---------------------------------------------------------------------------


async def call_gemini_api(api_key: str, prompt: str) -> str:
    """Gemini API를 비동기로 호출하여 텍스트 응답 반환."""
    try:
        from google import genai
        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
        )
        return response.text
    except Exception as e:
        logger.error("Gemini API error: %s", e)
        raise


async def call_claude_api(api_key: str, prompt: str) -> str:
    """Anthropic Claude API를 비동기로 호출하여 텍스트 응답 반환."""
    try:
        import anthropic
        client = anthropic.Anthropic(api_key=api_key)
        message = client.messages.create(
            model="claude-opus-4-5",
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}],
        )
        return message.content[0].text
    except Exception as e:
        logger.error("Claude API error: %s", e)
        raise


# ---------------------------------------------------------------------------
# AIRetirementGuideService
# ---------------------------------------------------------------------------


class AIRetirementGuideService:
    """AI 은퇴설계 가이드 서비스."""

    # ------------------------------------------------------------------
    # 복리 역산 계산 메서드
    # ------------------------------------------------------------------

    @staticmethod
    def calculate_adjusted_savings(
        current_evaluation: float,
        target_fund: float,
        annual_rate: float,
        remaining_years: int,
    ) -> float:
        """방안 1: 적립액 조정 - 목표 달성을 위한 연간 적립액 PMT 역산.

        FV = PV*(1+r)^n + PMT*((1+r)^n - 1)/r
        PMT = (FV - PV*(1+r)^n) * r / ((1+r)^n - 1)

        Returns:
            필요 연간 적립액 (float). 기간이 0이면 0.0 반환.
        """
        if remaining_years <= 0:
            return 0.0
        if annual_rate <= 0:
            # 수익률 0이면 단순 분할
            remaining_fund = target_fund - current_evaluation
            if remaining_fund <= 0:
                return 0.0
            return remaining_fund / remaining_years

        growth_factor = (1 + annual_rate) ** remaining_years
        pv_grown = current_evaluation * growth_factor
        remaining_fv = target_fund - pv_grown

        if remaining_fv <= 0:
            # 이미 현재 자산만으로 목표 초과 달성 가능
            return 0.0

        fv_annuity_factor = (growth_factor - 1) / annual_rate
        if fv_annuity_factor == 0:
            return 0.0

        return remaining_fv / fv_annuity_factor

    @staticmethod
    def calculate_required_return_rate(
        current_evaluation: float,
        annual_savings: float,
        target_fund: float,
        remaining_years: int,
        low: float = 0.0,
        high: float = 0.5,
        tolerance: float = 1e-6,
        max_iterations: int = 100,
    ) -> Optional[float]:
        """방안 2: 수익률 조정 - 이진탐색으로 필요 수익률 역산.

        FV(r) = PV*(1+r)^n + PMT*((1+r)^n - 1)/r

        Returns:
            필요 수익률 (float, 0~1 범위). 찾지 못하면 None.
        """
        if remaining_years <= 0:
            return None

        def fv_at_rate(r: float) -> float:
            growth_factor = (1 + r) ** remaining_years
            if r == 0:
                return current_evaluation + annual_savings * remaining_years
            return current_evaluation * growth_factor + annual_savings * (growth_factor - 1) / r

        # 범위 내에서 해가 존재하는지 확인
        fv_low = fv_at_rate(low)
        fv_high = fv_at_rate(high)

        if fv_low >= target_fund:
            # 0% 수익률로도 달성 - 현재 적립액만으로도 충분
            return 0.0

        if fv_high < target_fund:
            # 50% 수익률로도 달성 불가
            return None

        # 이진탐색
        for _ in range(max_iterations):
            mid = (low + high) / 2
            fv_mid = fv_at_rate(mid)

            if abs(fv_mid - target_fund) < tolerance * target_fund:
                return round(mid, 6)

            if fv_mid < target_fund:
                low = mid
            else:
                high = mid

        return round((low + high) / 2, 6)

    @staticmethod
    def calculate_required_years(
        current_evaluation: float,
        annual_savings: float,
        annual_rate: float,
        target_fund: float,
        max_years: int = 100,
    ) -> Optional[int]:
        """방안 3: 기간 조정 - 현재 조건으로 목표 달성까지 필요 년수.

        매년 복리 성장 + 연간 적립으로 시뮬레이션.

        Returns:
            필요 추가 년수 (int). max_years 초과하면 None.
        """
        if current_evaluation >= target_fund:
            return 0

        balance = float(current_evaluation)
        for year in range(1, max_years + 1):
            balance = balance * (1 + annual_rate) + annual_savings
            if balance >= target_fund:
                return year

        return None

    # ------------------------------------------------------------------
    # 통합 방안 구성
    # ------------------------------------------------------------------

    def build_adjustments(
        self,
        current_evaluation: float,
        plan_annual_savings: float,
        plan_return_rate: float,
        remaining_years: int,
        target_fund: float,
    ) -> list[dict]:
        """3가지 조정 방안을 계산하여 리스트로 반환."""

        # 방안 1: 적립액 조정
        suggested_savings = self.calculate_adjusted_savings(
            current_evaluation=current_evaluation,
            target_fund=target_fund,
            annual_rate=plan_return_rate,
            remaining_years=remaining_years,
        )
        savings_adj = {
            "type": "savings_adjustment",
            "current": plan_annual_savings,
            "suggested": round(suggested_savings, 0),
            "description": (
                f"현재 연간 적립액 {plan_annual_savings:,.0f}원에서 "
                f"{suggested_savings:,.0f}원으로 증액 시 "
                f"{remaining_years}년 후 목표 {target_fund:,.0f}원 달성 가능합니다."
            ),
        }

        # 방안 2: 수익률 조정
        required_rate = self.calculate_required_return_rate(
            current_evaluation=current_evaluation,
            annual_savings=plan_annual_savings,
            target_fund=target_fund,
            remaining_years=remaining_years,
        )
        if required_rate is not None:
            rate_desc = (
                f"현재 적립액 유지 시 연 수익률 {required_rate*100:.2f}%를 달성하면 "
                f"{remaining_years}년 후 목표 {target_fund:,.0f}원 달성 가능합니다."
            )
        else:
            rate_desc = "현재 적립액으로는 50% 수익률로도 목표 달성이 어렵습니다. 적립액 증액을 고려하세요."
        rate_adj = {
            "type": "return_rate_adjustment",
            "current": plan_return_rate,
            "suggested": round(required_rate, 6) if required_rate is not None else None,
            "description": rate_desc,
        }

        # 방안 3: 기간 조정
        required_years = self.calculate_required_years(
            current_evaluation=current_evaluation,
            annual_savings=plan_annual_savings,
            annual_rate=plan_return_rate,
            target_fund=target_fund,
        )
        if required_years is not None:
            extra_years = max(0, required_years - remaining_years)
            if required_years <= remaining_years:
                period_desc = (
                    f"현재 조건 유지 시 {required_years}년 만에 목표 달성 가능합니다 "
                    f"(계획보다 {remaining_years - required_years}년 단축)."
                )
            else:
                period_desc = (
                    f"현재 조건 유지 시 목표 달성까지 {required_years}년 소요됩니다 "
                    f"(계획보다 {extra_years}년 추가 필요)."
                )
        else:
            period_desc = "현재 조건으로는 100년 이내 목표 달성이 어렵습니다. 적립액 또는 수익률 조정이 필요합니다."
        period_adj = {
            "type": "period_adjustment",
            "current": remaining_years,
            "suggested": required_years,
            "description": period_desc,
        }

        return [savings_adj, rate_adj, period_adj]

    # ------------------------------------------------------------------
    # AI 호출
    # ------------------------------------------------------------------

    async def _call_ai_api(self, prompt: str, db: AsyncSession) -> str:
        """DB에서 활성 AI API 설정을 조회하여 AI API 호출.

        Raises:
            Exception: 활성 API 키가 없거나 호출 실패 시.
        """
        # 활성 AI API 설정 조회
        result = await db.execute(
            select(AIAPISetting).where(AIAPISetting.is_active == True)  # noqa: E712
        )
        setting = result.scalar_one_or_none()

        if setting is None:
            raise RuntimeError("활성화된 AI API 설정이 없습니다.")

        api_key = decrypt_api_key(setting.api_key_encrypted)
        provider = setting.provider.lower()

        if provider in ("gemini", "google"):
            return await call_gemini_api(api_key=api_key, prompt=prompt)
        elif provider in ("anthropic", "claude"):
            return await call_claude_api(api_key=api_key, prompt=prompt)
        else:
            # 기본값: gemini 시도
            return await call_gemini_api(api_key=api_key, prompt=prompt)

    async def get_ai_explanation(
        self,
        deviation_rate: float,
        adjustments: list[dict],
        db: Optional[AsyncSession],
    ) -> Optional[str]:
        """AI 설명 생성. 실패 시 None 반환 (graceful degradation).

        Args:
            deviation_rate: 이격률 (%)
            adjustments: 계산된 3가지 방안
            db: AsyncSession (None이면 AI 호출 불가)

        Returns:
            AI 설명 텍스트 또는 None.
        """
        if db is None:
            return None

        try:
            # 프롬프트 구성
            adj_text = "\n".join([
                f"- [{a['type']}] 현재: {a['current']}, 제안: {a['suggested']}\n  {a['description']}"
                for a in adjustments
            ])
            prompt = (
                "종합금융자산관리사로서, 다음 은퇴플랜 상황을 분석하고 조정 방안의 타당성을 설명해주세요. "
                "시장 상황, 장기 투자 전망, 고객 의지를 고려하여 구체적 근거를 제시해주세요.\n\n"
                f"현재 이격률: {deviation_rate:.2f}%\n"
                f"(이격률이 음수이면 계획 대비 현재 자산이 부족한 상황)\n\n"
                "조정 방안:\n"
                f"{adj_text}\n\n"
                "위 3가지 방안 각각의 현실적 실행 가능성과 권장 우선순위를 한국어로 설명해주세요."
            )

            return await self._call_ai_api(prompt=prompt, db=db)

        except Exception as e:
            logger.warning("AI explanation failed (graceful degradation): %s", e)
            return None

    # ------------------------------------------------------------------
    # 통합 실행
    # ------------------------------------------------------------------

    async def run(
        self,
        current_evaluation: float,
        plan_annual_savings: float,
        plan_return_rate: float,
        remaining_years: int,
        target_fund: float,
        deviation_rate: float,
        db: AsyncSession,
    ) -> dict:
        """은퇴 가이드 통합 실행.

        Returns:
            {
                "adjustments": list[dict],
                "ai_explanation": str | None,
            }
        """
        adjustments = self.build_adjustments(
            current_evaluation=current_evaluation,
            plan_annual_savings=plan_annual_savings,
            plan_return_rate=plan_return_rate,
            remaining_years=remaining_years,
            target_fund=target_fund,
        )

        ai_explanation = await self.get_ai_explanation(
            deviation_rate=deviation_rate,
            adjustments=adjustments,
            db=db,
        )

        return {
            "adjustments": adjustments,
            "ai_explanation": ai_explanation,
        }
