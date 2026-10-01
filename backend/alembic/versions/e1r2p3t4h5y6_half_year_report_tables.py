"""반기 기업 종합보고서 테이블 4개 (기획 6장·8장, P4-1).

company_documents(자료함 읽은 결과) / company_reports(보고서·버전) / report_images(이미지 후보·선택) /
report_exports(출력 기록)

Revision ID: e1r2p3t4h5y6
Revises: d9r1e2a3s4n5
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "e1r2p3t4h5y6"
down_revision = "d9r1e2a3s4n5"
branch_labels = None
depends_on = None


def _ts():
    return [sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False)]


def upgrade() -> None:
    op.create_table(
        "company_documents",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("company_id", sa.String(36), sa.ForeignKey("portfolio_companies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("file_id", sa.String(36), sa.ForeignKey("company_files.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("filename", sa.String(300), nullable=False),
        sa.Column("file_type", sa.String(10), nullable=False),
        sa.Column("size", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("page_count", sa.Integer()),
        sa.Column("extract_status", sa.String(12), nullable=False, server_default="pending"),
        sa.Column("extract_method", sa.String(30)),
        sa.Column("extract_error", sa.Text()),
        sa.Column("extracted_text", sa.Text()),
        sa.Column("extracted_images", JSONB),
        sa.Column("doc_type", sa.String(20)),
        sa.Column("ai_memo", sa.Text()),
        sa.Column("ai_facts", JSONB),
        sa.Column("has_personal_investment", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("use_in_report", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("is_public", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("uploaded_by", sa.String(36)),
        *_ts(),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_company_documents_company_id", "company_documents", ["company_id"])

    op.create_table(
        "company_reports",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("company_id", sa.String(36), sa.ForeignKey("portfolio_companies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("report_type", sa.String(12), nullable=False, server_default="half_year"),
        sa.Column("period_year", sa.Integer(), nullable=False),
        sa.Column("period_half", sa.Integer(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("owner_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("base_report_id", sa.String(36)),
        sa.Column("status", sa.String(12), nullable=False, server_default="generating"),
        sa.Column("progress_step", sa.String(40)),
        sa.Column("progress", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("as_of_date", sa.Date()),
        sa.Column("content", JSONB),
        sa.Column("sources", JSONB),
        sa.Column("review", JSONB),
        sa.Column("sales_note", JSONB),
        sa.Column("main_model", sa.String(60)),
        sa.Column("review_model", sa.String(60)),
        sa.Column("token_usage", JSONB),
        sa.Column("error", sa.Text()),
        sa.Column("created_by", sa.String(36)),
        sa.Column("finalized_by", sa.String(36)),
        sa.Column("finalized_at", sa.DateTime()),
        *_ts(),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_company_reports_company_id", "company_reports", ["company_id"])
    op.create_index("ix_company_reports_owner_user_id", "company_reports", ["owner_user_id"])
    op.create_index("ix_company_reports_period", "company_reports", ["company_id", "period_year", "period_half"])

    op.create_table(
        "report_images",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("report_id", sa.String(36), sa.ForeignKey("company_reports.id", ondelete="CASCADE"), nullable=False),
        sa.Column("section_no", sa.Integer()),
        sa.Column("kind", sa.String(12), nullable=False),
        sa.Column("storage_key", sa.String(300), nullable=False),
        sa.Column("document_id", sa.String(36)),
        sa.Column("caption", sa.String(300)),
        sa.Column("source_label", sa.String(200)),
        sa.Column("source_url", sa.String(500)),
        sa.Column("rights_note", sa.String(200)),
        sa.Column("width", sa.Integer()),
        sa.Column("height", sa.Integer()),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("selected", sa.Boolean(), nullable=False, server_default=sa.false()),
        *_ts(),
    )
    op.create_index("ix_report_images_report_id", "report_images", ["report_id"])

    op.create_table(
        "report_exports",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("report_id", sa.String(36), sa.ForeignKey("company_reports.id", ondelete="SET NULL")),
        sa.Column("version", sa.Integer()),
        sa.Column("format", sa.String(6), nullable=False),
        sa.Column("client_id", sa.String(36)),
        sa.Column("file_id", sa.String(36)),
        sa.Column("exported_by", sa.String(36)),
        sa.Column("exported_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_report_exports_report_id", "report_exports", ["report_id"])


def downgrade() -> None:
    op.drop_table("report_exports")
    op.drop_table("report_images")
    op.drop_table("company_reports")
    op.drop_table("company_documents")
