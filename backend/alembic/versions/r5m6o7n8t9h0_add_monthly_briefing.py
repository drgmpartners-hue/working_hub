"""기업 리포트 P3: 기업별 월간 요약·월간 브리핑.

Revision ID: r5m6o7n8t9h0
Revises: q4r5e6c7i8p9
Create Date: 2026-09-29 12:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "r5m6o7n8t9h0"
down_revision = "q4r5e6c7i8p9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "company_monthly_digests",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("company_id", sa.String(36), sa.ForeignKey("portfolio_companies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("month", sa.String(7), nullable=False),
        sa.Column("summary", sa.Text()),
        sa.Column("content", postgresql.JSONB()),
        sa.Column("key_fact_ids", postgresql.JSONB()),
        sa.Column("article_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("positive_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("caution_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("model", sa.String(80)),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("company_id", "month", name="uq_monthly_digest_company_month"),
    )
    op.create_index("ix_company_monthly_digests_company_id", "company_monthly_digests", ["company_id"])
    op.create_index("ix_company_monthly_digests_month", "company_monthly_digests", ["month"])
    op.create_table(
        "monthly_briefings",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("month", sa.String(7), nullable=False, unique=True),
        sa.Column("status", sa.String(12), nullable=False, server_default="generating"),
        sa.Column("content", postgresql.JSONB()),
        sa.Column("stats", postgresql.JSONB()),
        sa.Column("review_summary", postgresql.JSONB()),
        sa.Column("hold_reason", sa.Text()),
        sa.Column("approved_by", sa.String(36)),
        sa.Column("approved_at", sa.DateTime()),
        sa.Column("sent_at", sa.DateTime()),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("monthly_briefings")
    op.drop_index("ix_company_monthly_digests_month", table_name="company_monthly_digests")
    op.drop_index("ix_company_monthly_digests_company_id", table_name="company_monthly_digests")
    op.drop_table("company_monthly_digests")
