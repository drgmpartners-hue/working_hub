"""FastAPI application with authentication."""
import logging
import traceback
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

logger = logging.getLogger(__name__)
from app.api.v1 import auth, users, brand, ai_settings, upload, crawling, commission, content, portfolio, stock
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

app = FastAPI(title="API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(auth.router, prefix="/api/v1")
app.include_router(users.router, prefix="/api/v1")
app.include_router(brand.router, prefix="/api/v1")
app.include_router(upload.router, prefix="/api/v1")
app.include_router(crawling.router, prefix="/api/v1")
app.include_router(ai_settings.router, prefix="/api/v1")
app.include_router(commission.router, prefix="/api/v1")
app.include_router(content.router, prefix="/api/v1")
app.include_router(portfolio.router, prefix="/api/v1")
app.include_router(stock.router, prefix="/api/v1")
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


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error("Unhandled error: %s\n%s", exc, traceback.format_exc())
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc)},
    )


@app.get("/health")
async def health_check():
    return {"status": "healthy"}
