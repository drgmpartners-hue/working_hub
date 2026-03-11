"""Tests for database schema: model import, table existence, and column presence."""
import pytest


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

EXPECTED_TABLES = {
    "users",
    "commission_calculations",
    "commission_results",
    "crawling_jobs",
    "portfolio_analyses",
    "portfolio_items",
    "stock_themes",
    "stock_recommendations",
    "recommended_stocks",
    "company_stock_pool",
    "content_projects",
    "content_versions",
    "brand_settings",
    "ai_api_settings",
    "file_uploads",
}

# Required columns per table (subset check: these MUST exist)
REQUIRED_COLUMNS: dict[str, list[str]] = {
    "users": [
        "id", "email", "hashed_password", "nickname", "profile_image",
        "is_active", "is_superuser", "last_login", "created_at", "updated_at",
    ],
    "commission_calculations": [
        "id", "user_id", "calc_type", "source_file_path",
        "input_data", "result_data", "status", "created_at",
    ],
    "commission_results": [
        "id", "calculation_id", "employee_name", "detail_data", "report_file_path",
    ],
    "crawling_jobs": [
        "id", "source_type", "status", "result_data", "error_message", "created_at",
    ],
    "portfolio_analyses": [
        "id", "user_id", "data_source", "raw_data", "template_data",
        "ai_analysis", "rebalancing_suggestions", "report_file_path",
        "status", "created_at",
    ],
    "portfolio_items": [
        "id", "analysis_id", "product_name", "product_type",
        "current_value", "return_rate", "details",
    ],
    "stock_themes": [
        "id", "theme_name", "ai_score", "news_summary", "stock_count", "updated_at",
    ],
    "stock_recommendations": [
        "id", "user_id", "selected_themes", "ai_scores", "status", "created_at",
    ],
    "recommended_stocks": [
        "id", "recommendation_id", "stock_code", "stock_name", "theme", "rank",
        "return_1m", "return_3m", "return_6m", "institutional_buy", "foreign_buy",
        "is_top5", "analysis_report",
    ],
    "company_stock_pool": [
        "id", "pool_name", "stocks", "created_at",
    ],
    "content_projects": [
        "id", "user_id", "content_type", "title", "topic",
        "content_input", "brand_setting_id", "status", "created_at",
    ],
    "content_versions": [
        "id", "project_id", "version_number", "ai_text_content",
        "generated_assets", "file_path", "is_approved", "created_at",
    ],
    "brand_settings": [
        "id", "company_name", "primary_color", "secondary_color",
        "logo_path", "font_family", "style_config",
    ],
    "ai_api_settings": [
        "id", "provider", "api_key_encrypted", "is_active",
    ],
    "file_uploads": [
        "id", "file_name", "file_path", "file_size", "parsed_data", "uploaded_at",
    ],
}


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def metadata_tables():
    """Import all models and return Base.metadata.tables."""
    # Importing models registers them with Base.metadata
    import app.models  # noqa: F401 - side-effect import
    from app.db.base import Base

    return Base.metadata.tables


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestModelImports:
    """Verify every model class can be imported without error."""

    def test_import_user(self):
        from app.models.user import User
        assert User.__tablename__ == "users"

    def test_import_commission_calculation(self):
        from app.models.commission import CommissionCalculation
        assert CommissionCalculation.__tablename__ == "commission_calculations"

    def test_import_commission_result(self):
        from app.models.commission import CommissionResult
        assert CommissionResult.__tablename__ == "commission_results"

    def test_import_crawling_job(self):
        from app.models.crawling import CrawlingJob
        assert CrawlingJob.__tablename__ == "crawling_jobs"

    def test_import_portfolio_analysis(self):
        from app.models.portfolio import PortfolioAnalysis
        assert PortfolioAnalysis.__tablename__ == "portfolio_analyses"

    def test_import_portfolio_item(self):
        from app.models.portfolio import PortfolioItem
        assert PortfolioItem.__tablename__ == "portfolio_items"

    def test_import_stock_theme(self):
        from app.models.stock import StockTheme
        assert StockTheme.__tablename__ == "stock_themes"

    def test_import_stock_recommendation(self):
        from app.models.stock import StockRecommendation
        assert StockRecommendation.__tablename__ == "stock_recommendations"

    def test_import_recommended_stock(self):
        from app.models.stock import RecommendedStock
        assert RecommendedStock.__tablename__ == "recommended_stocks"

    def test_import_company_stock_pool(self):
        from app.models.stock import CompanyStockPool
        assert CompanyStockPool.__tablename__ == "company_stock_pool"

    def test_import_content_project(self):
        from app.models.content import ContentProject
        assert ContentProject.__tablename__ == "content_projects"

    def test_import_content_version(self):
        from app.models.content import ContentVersion
        assert ContentVersion.__tablename__ == "content_versions"

    def test_import_brand_setting(self):
        from app.models.brand import BrandSetting
        assert BrandSetting.__tablename__ == "brand_settings"

    def test_import_ai_api_setting(self):
        from app.models.ai_setting import AIAPISetting
        assert AIAPISetting.__tablename__ == "ai_api_settings"

    def test_import_file_upload(self):
        from app.models.file_upload import FileUpload
        assert FileUpload.__tablename__ == "file_uploads"

    def test_package_init_exports_all_models(self):
        """__init__.py must re-export every model class."""
        import app.models as models

        expected_classes = [
            "BrandSetting", "AIAPISetting", "FileUpload", "CrawlingJob",
            "StockTheme", "CompanyStockPool", "User",
            "CommissionCalculation", "CommissionResult",
            "PortfolioAnalysis", "PortfolioItem",
            "StockRecommendation", "RecommendedStock",
            "ContentProject", "ContentVersion",
        ]
        for cls_name in expected_classes:
            assert hasattr(models, cls_name), f"app.models is missing {cls_name}"


class TestTableRegistry:
    """Verify Base.metadata contains exactly the 15 expected tables."""

    def test_table_count(self, metadata_tables):
        actual = set(metadata_tables.keys())
        assert len(actual) == 15, (
            f"Expected 15 tables, got {len(actual)}.\n"
            f"Missing: {EXPECTED_TABLES - actual}\n"
            f"Extra:   {actual - EXPECTED_TABLES}"
        )

    def test_all_expected_tables_present(self, metadata_tables):
        actual = set(metadata_tables.keys())
        missing = EXPECTED_TABLES - actual
        assert not missing, f"Tables missing from metadata: {missing}"

    def test_no_unexpected_tables(self, metadata_tables):
        actual = set(metadata_tables.keys())
        extra = actual - EXPECTED_TABLES
        assert not extra, f"Unexpected tables in metadata: {extra}"


class TestRequiredColumns:
    """Verify each table has every required column defined."""

    @pytest.mark.parametrize("table_name,columns", REQUIRED_COLUMNS.items())
    def test_required_columns_exist(self, metadata_tables, table_name, columns):
        assert table_name in metadata_tables, f"Table '{table_name}' not found in metadata"
        table = metadata_tables[table_name]
        actual_columns = set(table.columns.keys())
        missing = set(columns) - actual_columns
        assert not missing, (
            f"Table '{table_name}' is missing columns: {missing}"
        )


class TestForeignKeys:
    """Spot-check that FK relationships are wired correctly."""

    def test_commission_calculations_fk_to_users(self, metadata_tables):
        table = metadata_tables["commission_calculations"]
        fk_targets = {fk.column.table.name for col in table.columns for fk in col.foreign_keys}
        assert "users" in fk_targets

    def test_commission_results_fk_to_calculations(self, metadata_tables):
        table = metadata_tables["commission_results"]
        fk_targets = {fk.column.table.name for col in table.columns for fk in col.foreign_keys}
        assert "commission_calculations" in fk_targets

    def test_portfolio_items_fk_to_portfolio_analyses(self, metadata_tables):
        table = metadata_tables["portfolio_items"]
        fk_targets = {fk.column.table.name for col in table.columns for fk in col.foreign_keys}
        assert "portfolio_analyses" in fk_targets

    def test_recommended_stocks_fk_to_stock_recommendations(self, metadata_tables):
        table = metadata_tables["recommended_stocks"]
        fk_targets = {fk.column.table.name for col in table.columns for fk in col.foreign_keys}
        assert "stock_recommendations" in fk_targets

    def test_content_projects_fk_to_users_and_brand_settings(self, metadata_tables):
        table = metadata_tables["content_projects"]
        fk_targets = {fk.column.table.name for col in table.columns for fk in col.foreign_keys}
        assert "users" in fk_targets
        assert "brand_settings" in fk_targets

    def test_content_versions_fk_to_content_projects(self, metadata_tables):
        table = metadata_tables["content_versions"]
        fk_targets = {fk.column.table.name for col in table.columns for fk in col.foreign_keys}
        assert "content_projects" in fk_targets
