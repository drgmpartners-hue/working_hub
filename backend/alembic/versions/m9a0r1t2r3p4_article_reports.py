"""'관련성 없는 기사' 제보 (2026-10-19).

Revision ID: m9a0r1t2r3p4
Revises: l8d9o0c1d2t3
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "m9a0r1t2r3p4"
down_revision = "l8d9o0c1d2t3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "article_reports",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("article_id", sa.String(36), sa.ForeignKey("news_articles.id", ondelete="CASCADE"), nullable=False),
        sa.Column("company_id", sa.String(36), sa.ForeignKey("portfolio_companies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("reporter_user_id", sa.String(36)),
        sa.Column("reporter_name", sa.String(100)),
        sa.Column("channel", sa.String(10), nullable=False, server_default="web"),
        sa.Column("reason", sa.String(300)),
        sa.Column("status", sa.String(10), nullable=False, server_default="open"),
        sa.Column("ai_analysis", postgresql.JSONB()),
        sa.Column("ai_analyzed_at", sa.DateTime()),
        sa.Column("resolution", sa.String(300)),
        sa.Column("resolved_by", sa.String(36)),
        sa.Column("resolved_at", sa.DateTime()),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_article_reports_article_id", "article_reports", ["article_id"])
    op.create_index("ix_article_reports_company_id", "article_reports", ["company_id"])
    op.create_index("ix_article_reports_status", "article_reports", ["status"])


def downgrade() -> None:
    op.drop_table("article_reports")
