"""SQLAlchemy models package.

Import order matters: models with no FK dependencies must come before
models that reference them via ForeignKey, so that mapper configuration
resolves correctly at startup.
"""

# No FK dependencies
from app.models.brand import BrandSetting
from app.models.ai_setting import AIAPISetting
from app.models.file_upload import FileUpload
from app.models.crawling import CrawlingJob
from app.models.stock import StockTheme, CompanyStockPool

# Depends on users
from app.models.user import User

# Depends on users
from app.models.commission import CommissionCalculation, CommissionResult
from app.models.portfolio import PortfolioAnalysis, PortfolioItem
from app.models.stock import StockRecommendation, RecommendedStock

# Depends on users (client management)
from app.models.client import Client, ClientAccount

# Depends on users + brand_settings
from app.models.content import ContentProject, ContentVersion

# Depends on client_accounts (portfolio snapshots)
from app.models.snapshot import PortfolioSnapshot, PortfolioHolding

# Depends on product_master
from app.models.product_master import ProductMaster

# No FK dependencies (global templates)
from app.models.recommended_portfolio import RecommendedPortfolioItem

# Depends on client_accounts (portal suggestions + reservations)
from app.models.portfolio_suggestion import PortfolioSuggestion
from app.models.call_reservation import CallReservation

# Depends on users (API keys)
from app.models.user_api_key import UserApiKey

# No FK dependencies (market analysis cache)
from app.models.market_analysis_cache import MarketAnalysisCache

# Depends on users (SMS templates)
from app.models.sms_template import SmsTemplate

# Depends on users (field options for dropdowns)
from app.models.field_option import FieldOption

# No FK dependencies (product name change memo)
from app.models.product_name_change import ProductNameChange

# Depends on users + clients + client_accounts (message logs)
from app.models.message_log import MessageLog

# Depends on users (retirement profiles - 1:1)
from app.models.customer_retirement_profile import CustomerRetirementProfile

# Depends on customer_retirement_profiles (desired plans)
from app.models.desired_plan import DesiredPlan

# No FK dependencies (wrap account product catalog)
from app.models.wrap_account import WrapAccount

# Depends on customer_retirement_profiles + wrap_accounts (investment records)
from app.models.investment_record import InvestmentRecord

# Depends on customer_retirement_profiles (retirement simulation plans)
from app.models.retirement_plan import RetirementPlan

# Depends on customer_retirement_profiles (interactive calculations - plan vs actual)
from app.models.interactive_calculation import InteractiveCalculation

# Depends on customer_retirement_profiles (pension distribution plans)
from app.models.pension_plan import PensionPlan

__all__ = [
    "BrandSetting",
    "AIAPISetting",
    "FileUpload",
    "CrawlingJob",
    "StockTheme",
    "CompanyStockPool",
    "User",
    "CommissionCalculation",
    "CommissionResult",
    "PortfolioAnalysis",
    "PortfolioItem",
    "StockRecommendation",
    "RecommendedStock",
    "Client",
    "ClientAccount",
    "ContentProject",
    "ContentVersion",
    "PortfolioSnapshot",
    "PortfolioHolding",
    "ProductMaster",
    "PortfolioSuggestion",
    "CallReservation",
    "UserApiKey",
    "RecommendedPortfolioItem",
    "MarketAnalysisCache",
    "SmsTemplate",
    "MessageLog",
    "FieldOption",
    "ProductNameChange",
    "CustomerRetirementProfile",
    "DesiredPlan",
    "WrapAccount",
    "InvestmentRecord",
    "RetirementPlan",
    "InteractiveCalculation",
    "PensionPlan",
]
