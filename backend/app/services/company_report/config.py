"""기업 리포트 설정값(app_settings key-value)과 기본값."""
from __future__ import annotations

from datetime import date
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.services import settings_store
from app.services.llm_client import DEFAULT_MAIN_MODEL, DEFAULT_REVIEW_MODEL, DEFAULT_SUMMARY_MODEL

# 키
BRIEFING_ENABLED = "news_briefing_enabled"            # "1"/"0"
REVIEW_UNTIL = "news_briefing_review_until"           # YYYY-MM-DD, 이 날까지 승인 후 발송
WEATHER_REGION = "briefing_weather_region"            # 기본 서울
MAIN_MODEL = "report_main_model"
REVIEW_MODEL = "report_review_model"
SUMMARY_MODEL = "briefing_summary_model"
LAST_RUN_AT = "news_briefing_last_run_at"
TEMPLATE_DAILY = "briefing_template_daily"          # 솔라피 템플릿 B ID(심사 승인 후 입력). 없으면 LMS로 보냄
TEMPLATE_MONTHLY = "briefing_template_monthly"      # 템플릿 C
LAST_SEND_AT = "news_briefing_last_send_at"
MONTHLY_ENABLED = "monthly_briefing_enabled"         # "1"/"0", 기본 켜짐(데일리 발송이 켜져 있을 때만)

WEB_BASE = "https://working-hub.vercel.app"
APPROVAL_DAYS = 7                                   # 시작 후 승인 필요 영업일 수

DEFAULT_REGION = "서울"


async def get_models(db: AsyncSession) -> dict[str, str]:
    return {
        "main": await settings_store.get(db, MAIN_MODEL, DEFAULT_MAIN_MODEL) or DEFAULT_MAIN_MODEL,
        "review": await settings_store.get(db, REVIEW_MODEL, DEFAULT_REVIEW_MODEL) or DEFAULT_REVIEW_MODEL,
        "summary": await settings_store.get(db, SUMMARY_MODEL, DEFAULT_SUMMARY_MODEL) or DEFAULT_SUMMARY_MODEL,
    }


async def review_until(db: AsyncSession) -> Optional[date]:
    v = await settings_store.get(db, REVIEW_UNTIL)
    if not v:
        return None
    try:
        return date.fromisoformat(v)
    except ValueError:
        return None


async def approval_required(db: AsyncSession, today: date) -> bool:
    """승인 모드 여부. 기본은 승인 없이 자동 발송(2026-09-29 결정).
    관리자가 [승인 기간 다시 시작]으로 종료일을 정했을 때만 그날까지 승인 후 발송."""
    until = await review_until(db)
    return until is not None and today <= until
