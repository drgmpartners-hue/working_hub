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

# Depends on users + brand_settings
from app.models.content import ContentProject, ContentVersion

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
    "ContentProject",
    "ContentVersion",
]
