"""theme_report_cache — LLM 생성 테마 보고서 일자별 캐시.

Revision ID: d7e8f9a0b1c2
Revises: c6d7e8f9a0b1
Create Date: 2026-06-10 09:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "d7e8f9a0b1c2"
down_revision = "c6d7e8f9a0b1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "theme_report_cache",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("theme_name", sa.String(length=200), nullable=False, index=True),
        sa.Column("period", sa.String(length=4), nullable=False),
        sa.Column("basis_date", sa.Date(), nullable=False),
        sa.Column("payload", JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        sa.UniqueConstraint("theme_name", "period", "basis_date", name="uq_theme_report"),
    )


def downgrade() -> None:
    op.drop_table("theme_report_cache")
