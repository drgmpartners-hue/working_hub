"""add phase column to stock_themes + app_settings table.

Revision ID: y2z3a4b5c6d7
Revises: x1y2z3a4b5c6
Create Date: 2026-06-09 02:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = "y2z3a4b5c6d7"
down_revision = "x1y2z3a4b5c6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("stock_themes", sa.Column("phase", sa.String(12), nullable=True))
    op.create_table(
        "app_settings",
        sa.Column("key", sa.String(80), primary_key=True, nullable=False),
        sa.Column("value", sa.Text(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("app_settings")
    op.drop_column("stock_themes", "phase")
