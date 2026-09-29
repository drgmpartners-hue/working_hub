"""기업 리포트: 카톡 브리핑용 짧은 기사 링크 + 사실 원장 자동 검증 결과.

Revision ID: s6h7o8r9t0l1
Revises: r5m6o7n8t9h0
Create Date: 2026-09-29 18:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "s6h7o8r9t0l1"
down_revision = "r5m6o7n8t9h0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "short_links",
        sa.Column("code", sa.String(12), primary_key=True),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("url_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("article_id", sa.String(36)),
        sa.Column("hits", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_short_links_article_id", "short_links", ["article_id"])
    op.add_column("company_facts", sa.Column("verification", postgresql.JSONB()))
    op.add_column("company_facts", sa.Column("verified_at", sa.DateTime()))


def downgrade() -> None:
    op.drop_column("company_facts", "verified_at")
    op.drop_column("company_facts", "verification")
    op.drop_index("ix_short_links_article_id", table_name="short_links")
    op.drop_table("short_links")
