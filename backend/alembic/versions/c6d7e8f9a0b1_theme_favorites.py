"""theme_favorites 테이블 — 사용자별 테마 즐겨찾기.

Revision ID: c6d7e8f9a0b1
Revises: b5c6d7e8f9a0
Create Date: 2026-06-10 08:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = "c6d7e8f9a0b1"
down_revision = "b5c6d7e8f9a0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "theme_favorites",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("theme_name", sa.String(length=200), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        sa.UniqueConstraint("user_id", "theme_name", name="uq_theme_fav"),
    )


def downgrade() -> None:
    op.drop_table("theme_favorites")
