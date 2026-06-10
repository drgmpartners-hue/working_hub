"""theme_daily_snapshots 테이블 + stock_themes 흐름/국면 컬럼.

네이버 테마 시세 일별 스냅샷(흐름) + 관심점수/국면 저장.

Revision ID: b5c6d7e8f9a0
Revises: a4b5c6d7e8f9
Create Date: 2026-06-10 07:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = "b5c6d7e8f9a0"
down_revision = "a4b5c6d7e8f9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "theme_daily_snapshots",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("theme_name", sa.String(length=200), nullable=False, index=True),
        sa.Column("snapshot_date", sa.Date(), nullable=False, index=True),
        sa.Column("change_rate", sa.Float(), nullable=True),
        sa.Column("up_count", sa.Integer(), nullable=True),
        sa.Column("down_count", sa.Integer(), nullable=True),
        sa.Column("news_count", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        sa.UniqueConstraint("theme_name", "snapshot_date", name="uq_theme_snap_date"),
    )
    op.create_index("ix_theme_snap", "theme_daily_snapshots", ["snapshot_date", "theme_name"])

    op.add_column("stock_themes", sa.Column("interest_score", sa.Float(), nullable=True))
    op.add_column("stock_themes", sa.Column("attention_phase", sa.String(length=12), nullable=True))
    op.add_column("stock_themes", sa.Column("change_rate", sa.Float(), nullable=True))
    op.add_column("stock_themes", sa.Column("up_count", sa.Integer(), nullable=True))
    op.add_column("stock_themes", sa.Column("down_count", sa.Integer(), nullable=True))
    op.add_column("stock_themes", sa.Column("basis_date", sa.Date(), nullable=True))


def downgrade() -> None:
    for col in ("interest_score", "attention_phase", "change_rate", "up_count", "down_count", "basis_date"):
        op.drop_column("stock_themes", col)
    op.drop_index("ix_theme_snap", table_name="theme_daily_snapshots")
    op.drop_table("theme_daily_snapshots")
