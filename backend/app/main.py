"""FastAPI application with authentication."""
import logging
import traceback
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

logger = logging.getLogger(__name__)
# 업무 자동화(수당정산)·주식·ETF 추천은 2026-10-01 삭제 (docs/login_logic P12). 테이블·기존 데이터는 그대로 둔다
from app.api.v1 import auth, users, brand, ai_settings, content, portfolio
from app.api.v1 import clients as clients_router
from app.api.v1 import snapshots as snapshots_router
from app.api.v1 import product_master as product_master_router
from app.api.v1 import reports as reports_router
from app.api.v1 import client_portal as client_portal_router
from app.api.v1 import portfolio_suggestions as portfolio_suggestions_router
from app.api.v1 import call_reservations as call_reservations_router
from app.api.v1 import user_api_keys as user_api_keys_router
from app.api.v1 import stock_search as stock_search_router
from app.api.v1 import messaging as messaging_router
from app.api.v1 import recommended_portfolio as recommended_portfolio_router
from app.api.v1 import sms_templates as sms_templates_router
from app.api.v1 import message_logs as message_logs_router
from app.api.v1 import field_options as field_options_router
from app.api.v1 import product_name_changes as product_name_changes_router
from app.api.v1 import retirement_profiles as retirement_profiles_router
from app.api.v1 import wrap_accounts as wrap_accounts_router
from app.api.v1 import desired_plans as desired_plans_router
from app.api.v1 import investment_records as investment_records_router
from app.api.v1 import retirement_plans as retirement_plans_router
from app.api.v1 import interactive_calculations as interactive_calculations_router
from app.api.v1 import pension_plans as pension_plans_router
from app.api.v1 import ai_retirement_guide as ai_retirement_guide_router
from app.api.v1 import inflation_rate as inflation_rate_router
from app.api.v1.deposit_accounts import router as deposit_accounts_router
from app.api.v1.deposit_accounts import transactions_router as deposit_transactions_router
from app.api.v1 import notion as notion_router
from app.api.v1 import company_report as company_report_router
from app.api.v1 import managers as managers_router
from app.api.v1 import admin as admin_router
from app.api.v1 import dashboard as dashboard_router

app = FastAPI(title="API", version="0.1.0")


@app.on_event("startup")
async def _check_security_settings() -> None:
    """수정_tasks P2-1: 운영에서 SECRET_KEY·ENCRYPTION_KEY 가 약하면 기동 중단(fail-fast).
    ENCRYPTION_KEY 가 새로 정해졌거나 바뀌었으면 저장된 주민번호·API 키를 새 키로 다시 암호화(백그라운드)."""
    import asyncio

    from app.core import encryption

    encryption.check_startup()

    async def _rotate() -> None:
        try:
            from app.db.session import AsyncSessionLocal

            async with AsyncSessionLocal() as db:
                await encryption.rotate_if_needed(db)
        except Exception:
            logger.exception("[보안 설정] 저장 데이터 다시 암호화 실패(다음 기동 때 다시 시도)")

    app.state.encryption_rotation = asyncio.create_task(_rotate())


@app.on_event("startup")
async def _start_company_db_worker() -> None:
    """기업 리포트: Volume이 붙은 웹 서비스에서 기업DB 자동 파일을 만든다(Cron 컨테이너는 파일을 쓰지 않음)."""
    import asyncio

    from app.services.company_report import file_worker

    if file_worker.enabled():
        app.state.company_db_worker = asyncio.create_task(file_worker.loop())
    try:  # 재시작 전에 돌던 과거 데이터 구축 작업은 중단된 것으로 표시
        from app.services.company_report import backfill

        await backfill.fail_stale_jobs()
    except Exception:  # DB가 아직 준비 안 됐어도 서버는 뜨게
        pass

ALLOWED_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000", "https://working-hub.vercel.app"]
# 회사 도메인의 하위 주소(예: https://hub.drgm.co.kr) — 아임웹 DNS에서 Vercel로 연결한 주소
ALLOWED_ORIGIN_REGEX = r"https://([a-z0-9-]+\.)*drgm\.co\.kr"

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=ALLOWED_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(auth.router, prefix="/api/v1")
app.include_router(users.router, prefix="/api/v1")
app.include_router(brand.router, prefix="/api/v1")
app.include_router(ai_settings.router, prefix="/api/v1")
app.include_router(content.router, prefix="/api/v1")
app.include_router(portfolio.router, prefix="/api/v1")
app.include_router(clients_router.router, prefix="/api/v1")
app.include_router(snapshots_router.router, prefix="/api/v1")
app.include_router(product_master_router.router, prefix="/api/v1")
app.include_router(reports_router.router, prefix="/api/v1")
app.include_router(client_portal_router.router, prefix="/api/v1")
app.include_router(portfolio_suggestions_router.router, prefix="/api/v1")
app.include_router(call_reservations_router.router, prefix="/api/v1")
app.include_router(user_api_keys_router.router, prefix="/api/v1")
app.include_router(stock_search_router.router, prefix="/api/v1")
app.include_router(messaging_router.router, prefix="/api/v1")
app.include_router(recommended_portfolio_router.router, prefix="/api/v1")
app.include_router(sms_templates_router.router, prefix="/api/v1")
app.include_router(message_logs_router.router, prefix="/api/v1")
app.include_router(field_options_router.router, prefix="/api/v1")
app.include_router(product_name_changes_router.router, prefix="/api/v1")
app.include_router(retirement_profiles_router.router, prefix="/api/v1")
app.include_router(wrap_accounts_router.router, prefix="/api/v1")
app.include_router(desired_plans_router.router, prefix="/api/v1")
app.include_router(investment_records_router.router, prefix="/api/v1")
app.include_router(retirement_plans_router.router, prefix="/api/v1")
app.include_router(interactive_calculations_router.router, prefix="/api/v1")
app.include_router(pension_plans_router.router, prefix="/api/v1")
app.include_router(ai_retirement_guide_router.router, prefix="/api/v1")
app.include_router(inflation_rate_router.router, prefix="/api/v1")
app.include_router(deposit_accounts_router, prefix="/api/v1")
app.include_router(deposit_transactions_router, prefix="/api/v1")
app.include_router(notion_router.router, prefix="/api/v1")
app.include_router(company_report_router.router, prefix="/api/v1")
app.include_router(managers_router.router, prefix="/api/v1")
app.include_router(admin_router.router, prefix="/api/v1")
app.include_router(dashboard_router.router, prefix="/api/v1")


@app.middleware("http")
async def audit_middleware(request: Request, call_next):
    """감사 로그 1층: 로그인한 사용자의 쓰기 요청(POST·PUT·PATCH·DELETE)을 성공·실패 모두 기록.

    actor(실제 행위자)와 effective(권한 계정)를 함께 남겨 대행 작업을 구분한다 (docs/login_logic P6-2).
    기록 실패는 본 요청에 영향을 주지 않는다.
    """
    response = await call_next(request)
    if request.method in ("POST", "PUT", "PATCH", "DELETE"):
        from app.services.audit_service import log_write_request

        await log_write_request(request, response.status_code)
    return response


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error("Unhandled error: %s\n%s", exc, traceback.format_exc())
    # 예외 핸들러가 만든 500 응답은 CORSMiddleware를 거치지 않아 CORS 헤더가 누락된다.
    # → 브라우저에서 실제 오류 메시지 대신 "Failed to fetch"로 보임. 허용 오리진이면 수동으로 부착.
    headers: dict[str, str] = {}
    origin = request.headers.get("origin")
    if origin is not None and origin in ALLOWED_ORIGINS:
        headers["Access-Control-Allow-Origin"] = origin
        headers["Access-Control-Allow-Credentials"] = "true"
    return JSONResponse(
        status_code=500,
        # 일부 예외(InvalidToken 등)는 str(exc)가 빈 문자열 → 프런트에서 빈 에러로 보임
        content={"detail": str(exc) or f"서버 내부 오류: {type(exc).__name__}"},
        headers=headers,
    )


@app.get("/health")
async def health_check():
    return {"status": "healthy"}


@app.get("/api/v1/version")
async def version_info():
    """배포 버전 확인(수정_tasks P1-4): 화면 구석의 환경 배지가 서버 쪽 커밋을 보여 준다(Railway 가 넣는 값)."""
    import os

    from app.core import encryption

    sha = os.environ.get("RAILWAY_GIT_COMMIT_SHA") or os.environ.get("GIT_COMMIT_SHA") or ""
    return {
        "env": "production" if encryption.is_production() else "local",
        "commit": sha[:7] or None,
        "branch": os.environ.get("RAILWAY_GIT_BRANCH") or None,
    }
