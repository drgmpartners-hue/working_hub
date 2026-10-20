"""기사 수집 근거·AI 판정 역할 (2026-10-20).

Revision ID: n0r1e2a3s4n5
Revises: m9a0r1t2r3p4
"""
from alembic import op
import sqlalchemy as sa

revision = "n0r1e2a3s4n5"
down_revision = "m9a0r1t2r3p4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("news_articles", sa.Column("relevance_reason", sa.String(200)))
    op.add_column("news_articles", sa.Column("ai_role", sa.String(10)))


def downgrade() -> None:
    op.drop_column("news_articles", "ai_role")
    op.drop_column("news_articles", "relevance_reason")
