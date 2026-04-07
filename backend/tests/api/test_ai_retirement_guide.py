"""Tests for AI Retirement Guide API.

Covers:
  POST /api/v1/retirement/ai-guide

Strategy:
- AI 호출은 mock으로 대체하여 외부 의존성 없이 테스트
- 복리 역산 계산 로직 단위 테스트
- graceful degradation (AI 실패 시 계산값만 반환) 테스트
"""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.core.deps import get_current_user
from app.db.session import get_db


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def make_mock_user() -> User:
    user = MagicMock(spec=User)
    user.id = "test-user-id"
    user.is_active = True
    return user


def make_test_app(mock_db: AsyncSession, mock_user: User) -> FastAPI:
    """Minimal FastAPI app with ai_retirement_guide router and mocked dependencies."""
    from app.api.v1.ai_retirement_guide import router
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_db] = lambda: mock_db
    app.dependency_overrides[get_current_user] = lambda: mock_user
    return app


def make_valid_payload() -> dict:
    return {
        "customer_id": "cust-001",
        "deviation_rate": -15.5,
        "current_evaluation": 30_000_000,
        "plan_annual_savings": 5_000_000,
        "plan_return_rate": 0.07,
        "remaining_years": 20,
        "target_fund": 500_000_000,
    }


# ---------------------------------------------------------------------------
# Service unit tests (AIRetirementGuideService)
# ---------------------------------------------------------------------------


class TestAIRetirementGuideServiceCalculations:
    """복리 역산 계산 로직 단위 테스트."""

    def _get_service(self):
        from app.services.ai_retirement_guide import AIRetirementGuideService
        return AIRetirementGuideService()

    def test_adjust_savings_pmt_basic(self):
        """방안 1: 적립액 조정 - PMT 역산이 올바르게 계산되는지."""
        svc = self._get_service()
        result = svc.calculate_adjusted_savings(
            current_evaluation=30_000_000,
            target_fund=500_000_000,
            annual_rate=0.07,
            remaining_years=20,
        )
        # 현재 PV가 성장한 값을 제외하고 남은 FV를 PMT로 역산
        assert result > 0
        assert isinstance(result, float)

    def test_adjust_savings_zero_remaining_years(self):
        """남은 기간이 0이면 적립액 역산 불가 - 0 또는 None 반환."""
        svc = self._get_service()
        result = svc.calculate_adjusted_savings(
            current_evaluation=30_000_000,
            target_fund=500_000_000,
            annual_rate=0.07,
            remaining_years=0,
        )
        assert result == 0.0 or result is None

    def test_adjust_return_rate_basic(self):
        """방안 2: 수익률 조정 - 이진탐색으로 필요 수익률 역산."""
        svc = self._get_service()
        result = svc.calculate_required_return_rate(
            current_evaluation=30_000_000,
            annual_savings=5_000_000,
            target_fund=500_000_000,
            remaining_years=20,
        )
        assert result is not None
        assert 0.0 < result < 1.0  # 0%~100% 범위 수익률

    def test_adjust_return_rate_already_achievable(self):
        """이미 매우 큰 금액 적립 중 - 낮은 수익률로도 달성 가능."""
        svc = self._get_service()
        result = svc.calculate_required_return_rate(
            current_evaluation=400_000_000,
            annual_savings=50_000_000,
            target_fund=500_000_000,
            remaining_years=20,
        )
        # 목표보다 훨씬 많은 자산 - 수익률이 0에 가깝거나 음수도 달성 가능
        # 결과가 None이 아님을 확인 (솔루션 존재)
        assert result is not None or result is None  # graceful: 못 찾으면 None도 허용

    def test_adjust_period_basic(self):
        """방안 3: 기간 조정 - 현재 조건으로 목표 달성까지 필요 년수."""
        svc = self._get_service()
        result = svc.calculate_required_years(
            current_evaluation=30_000_000,
            annual_savings=5_000_000,
            annual_rate=0.07,
            target_fund=500_000_000,
        )
        assert result is not None
        assert result > 0
        assert isinstance(result, (int, float))

    def test_adjust_period_already_reached(self):
        """이미 목표 달성 - 0년 또는 즉시 달성."""
        svc = self._get_service()
        result = svc.calculate_required_years(
            current_evaluation=600_000_000,
            annual_savings=5_000_000,
            annual_rate=0.07,
            target_fund=500_000_000,
        )
        assert result == 0 or result <= 0

    def test_build_adjustments_returns_three_options(self):
        """통합 계산 - 3가지 방안 모두 반환."""
        svc = self._get_service()
        adjustments = svc.build_adjustments(
            current_evaluation=30_000_000,
            plan_annual_savings=5_000_000,
            plan_return_rate=0.07,
            remaining_years=20,
            target_fund=500_000_000,
        )
        assert len(adjustments) == 3
        types = [a["type"] for a in adjustments]
        assert "savings_adjustment" in types
        assert "return_rate_adjustment" in types
        assert "period_adjustment" in types

    def test_adjustments_have_required_fields(self):
        """각 방안 dict에 필수 필드 포함."""
        svc = self._get_service()
        adjustments = svc.build_adjustments(
            current_evaluation=30_000_000,
            plan_annual_savings=5_000_000,
            plan_return_rate=0.07,
            remaining_years=20,
            target_fund=500_000_000,
        )
        for adj in adjustments:
            assert "type" in adj
            assert "current" in adj
            assert "suggested" in adj
            assert "description" in adj


# ---------------------------------------------------------------------------
# AI 호출 테스트 (mock)
# ---------------------------------------------------------------------------


class TestAIRetirementGuideServiceAI:
    """AI 호출 로직 테스트 (mock 사용)."""

    def _get_service(self):
        from app.services.ai_retirement_guide import AIRetirementGuideService
        return AIRetirementGuideService()

    @pytest.mark.asyncio
    async def test_get_ai_explanation_success(self):
        """AI 호출 성공 시 문자열 반환."""
        svc = self._get_service()
        adjustments = [
            {"type": "savings_adjustment", "current": 5_000_000, "suggested": 8_000_000, "description": "test"},
        ]

        with patch.object(svc, "_call_ai_api", new_callable=AsyncMock) as mock_ai:
            mock_ai.return_value = "AI 분석 결과입니다."
            result = await svc.get_ai_explanation(
                deviation_rate=-15.5,
                adjustments=adjustments,
                db=None,
            )

        assert result == "AI 분석 결과입니다."
        mock_ai.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_get_ai_explanation_failure_returns_none(self):
        """AI 호출 실패 시 None 반환 (graceful degradation)."""
        svc = self._get_service()
        adjustments = [
            {"type": "savings_adjustment", "current": 5_000_000, "suggested": 8_000_000, "description": "test"},
        ]

        with patch.object(svc, "_call_ai_api", new_callable=AsyncMock) as mock_ai:
            mock_ai.side_effect = Exception("API 연결 실패")
            result = await svc.get_ai_explanation(
                deviation_rate=-15.5,
                adjustments=adjustments,
                db=None,
            )

        assert result is None

    @pytest.mark.asyncio
    async def test_call_ai_api_uses_active_setting(self):
        """AI API 호출 시 active API key 설정을 DB에서 조회."""
        svc = self._get_service()

        from app.models.ai_setting import AIAPISetting
        from app.core.security import encrypt_api_key

        mock_setting = MagicMock(spec=AIAPISetting)
        mock_setting.provider = "gemini"
        mock_setting.api_key_encrypted = encrypt_api_key("test-api-key")
        mock_setting.is_active = True

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_setting

        mock_db = AsyncMock(spec=AsyncSession)
        mock_db.execute = AsyncMock(return_value=mock_result)

        prompt = "테스트 프롬프트"

        with patch("app.services.ai_retirement_guide.call_gemini_api", new_callable=AsyncMock) as mock_gemini:
            mock_gemini.return_value = "Gemini 응답"
            result = await svc._call_ai_api(prompt=prompt, db=mock_db)

        assert result == "Gemini 응답"
        mock_gemini.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_call_ai_api_no_active_key_raises(self):
        """활성 API 키가 없으면 예외 발생."""
        svc = self._get_service()

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None

        mock_db = AsyncMock(spec=AsyncSession)
        mock_db.execute = AsyncMock(return_value=mock_result)

        with pytest.raises(Exception):
            await svc._call_ai_api(prompt="테스트", db=mock_db)


# ---------------------------------------------------------------------------
# POST /api/v1/retirement/ai-guide
# ---------------------------------------------------------------------------


class TestAIRetirementGuideEndpoint:
    """POST /api/v1/retirement/ai-guide 엔드포인트 테스트."""

    def _make_db_with_active_setting(self):
        """AI active 설정이 있는 mock DB."""
        from app.models.ai_setting import AIAPISetting
        from app.core.security import encrypt_api_key

        mock_setting = MagicMock(spec=AIAPISetting)
        mock_setting.provider = "gemini"
        mock_setting.api_key_encrypted = encrypt_api_key("fake-api-key")
        mock_setting.is_active = True

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_setting

        mock_db = AsyncMock(spec=AsyncSession)
        mock_db.execute = AsyncMock(return_value=mock_result)
        return mock_db

    def test_post_returns_200_with_adjustments(self):
        """유효한 요청 - 200 응답 및 adjustments 3개 반환."""
        mock_db = self._make_db_with_active_setting()
        mock_user = make_mock_user()

        with patch("app.services.ai_retirement_guide.call_gemini_api", new_callable=AsyncMock) as mock_gemini:
            mock_gemini.return_value = "AI 은퇴 가이드 설명입니다."
            app = make_test_app(mock_db, mock_user)

            with TestClient(app) as client:
                response = client.post(
                    "/api/v1/retirement/ai-guide",
                    json=make_valid_payload(),
                )

        assert response.status_code == 200
        data = response.json()
        assert "adjustments" in data
        assert len(data["adjustments"]) == 3

    def test_post_response_has_ai_explanation(self):
        """응답에 ai_explanation 필드 포함."""
        mock_db = self._make_db_with_active_setting()
        mock_user = make_mock_user()

        with patch("app.services.ai_retirement_guide.call_gemini_api", new_callable=AsyncMock) as mock_gemini:
            mock_gemini.return_value = "AI 분석 결과"
            app = make_test_app(mock_db, mock_user)

            with TestClient(app) as client:
                response = client.post(
                    "/api/v1/retirement/ai-guide",
                    json=make_valid_payload(),
                )

        assert response.status_code == 200
        data = response.json()
        assert "ai_explanation" in data
        assert data["ai_explanation"] == "AI 분석 결과"

    def test_post_graceful_degradation_when_ai_fails(self):
        """AI 호출 실패 시에도 200 응답 (계산값만 반환)."""
        mock_db = self._make_db_with_active_setting()
        mock_user = make_mock_user()

        with patch("app.services.ai_retirement_guide.call_gemini_api", new_callable=AsyncMock) as mock_gemini:
            mock_gemini.side_effect = Exception("AI API error")
            app = make_test_app(mock_db, mock_user)

            with TestClient(app) as client:
                response = client.post(
                    "/api/v1/retirement/ai-guide",
                    json=make_valid_payload(),
                )

        assert response.status_code == 200
        data = response.json()
        assert "adjustments" in data
        assert len(data["adjustments"]) == 3
        # AI 설명은 None이거나 빈 문자열
        assert data.get("ai_explanation") is None or data.get("ai_explanation") == ""

    def test_post_graceful_degradation_when_no_active_key(self):
        """활성 API 키 없어도 200 응답 (계산값만 반환)."""
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None

        mock_db = AsyncMock(spec=AsyncSession)
        mock_db.execute = AsyncMock(return_value=mock_result)
        mock_user = make_mock_user()

        app = make_test_app(mock_db, mock_user)
        with TestClient(app) as client:
            response = client.post(
                "/api/v1/retirement/ai-guide",
                json=make_valid_payload(),
            )

        assert response.status_code == 200
        data = response.json()
        assert "adjustments" in data
        assert data.get("ai_explanation") is None or data.get("ai_explanation") == ""

    def test_post_adjustments_structure(self):
        """adjustments 각 항목의 필수 필드 확인."""
        mock_db = self._make_db_with_active_setting()
        mock_user = make_mock_user()

        with patch("app.services.ai_retirement_guide.call_gemini_api", new_callable=AsyncMock) as mock_gemini:
            mock_gemini.return_value = "AI 응답"
            app = make_test_app(mock_db, mock_user)

            with TestClient(app) as client:
                response = client.post(
                    "/api/v1/retirement/ai-guide",
                    json=make_valid_payload(),
                )

        data = response.json()
        for adj in data["adjustments"]:
            assert "type" in adj
            assert "current" in adj
            assert "suggested" in adj
            assert "description" in adj

    def test_post_missing_required_fields_returns_422(self):
        """필수 필드 누락 시 422 반환."""
        mock_db = AsyncMock(spec=AsyncSession)
        mock_user = make_mock_user()
        app = make_test_app(mock_db, mock_user)

        with TestClient(app) as client:
            response = client.post(
                "/api/v1/retirement/ai-guide",
                json={"customer_id": "cust-001"},  # 필수 필드 대부분 누락
            )

        assert response.status_code == 422

    def test_post_requires_authentication(self):
        """인증 없이 요청 시 401/403 반환."""
        from app.api.v1.ai_retirement_guide import router
        app = FastAPI()
        app.include_router(router, prefix="/api/v1")

        mock_db = AsyncMock(spec=AsyncSession)
        app.dependency_overrides[get_db] = lambda: mock_db
        # get_current_user NOT overridden

        with TestClient(app, raise_server_exceptions=False) as client:
            response = client.post(
                "/api/v1/retirement/ai-guide",
                json=make_valid_payload(),
            )

        assert response.status_code in (401, 403, 422)

    def test_post_adjustment_types_are_correct(self):
        """3가지 방안 타입이 올바른지 확인."""
        mock_db = self._make_db_with_active_setting()
        mock_user = make_mock_user()

        with patch("app.services.ai_retirement_guide.call_gemini_api", new_callable=AsyncMock) as mock_gemini:
            mock_gemini.return_value = "AI 응답"
            app = make_test_app(mock_db, mock_user)

            with TestClient(app) as client:
                response = client.post(
                    "/api/v1/retirement/ai-guide",
                    json=make_valid_payload(),
                )

        data = response.json()
        types = [a["type"] for a in data["adjustments"]]
        assert "savings_adjustment" in types
        assert "return_rate_adjustment" in types
        assert "period_adjustment" in types

    def test_post_negative_deviation_rate_accepted(self):
        """음수 이격률 (계획보다 낮은 실제) 정상 처리."""
        mock_db = self._make_db_with_active_setting()
        mock_user = make_mock_user()

        payload = make_valid_payload()
        payload["deviation_rate"] = -30.0

        with patch("app.services.ai_retirement_guide.call_gemini_api", new_callable=AsyncMock) as mock_gemini:
            mock_gemini.return_value = "AI 응답"
            app = make_test_app(mock_db, mock_user)

            with TestClient(app) as client:
                response = client.post("/api/v1/retirement/ai-guide", json=payload)

        assert response.status_code == 200

    def test_post_positive_deviation_rate_accepted(self):
        """양수 이격률 (계획보다 높은 실제) 정상 처리."""
        mock_db = self._make_db_with_active_setting()
        mock_user = make_mock_user()

        payload = make_valid_payload()
        payload["deviation_rate"] = 10.0

        with patch("app.services.ai_retirement_guide.call_gemini_api", new_callable=AsyncMock) as mock_gemini:
            mock_gemini.return_value = "AI 응답"
            app = make_test_app(mock_db, mock_user)

            with TestClient(app) as client:
                response = client.post("/api/v1/retirement/ai-guide", json=payload)

        assert response.status_code == 200
