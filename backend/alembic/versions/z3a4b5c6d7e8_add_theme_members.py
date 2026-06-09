"""add theme_members table (DB-backed theme→stock mapping).

Revision ID: z3a4b5c6d7e8
Revises: y2z3a4b5c6d7
Create Date: 2026-06-09 03:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = "z3a4b5c6d7e8"
down_revision = "y2z3a4b5c6d7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "theme_members",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("theme_name", sa.String(200), nullable=False),
        sa.Column("code", sa.String(20), nullable=False),
        sa.Column("name", sa.String(100), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("theme_name", "code", name="uq_theme_member"),
    )
    op.create_index("ix_theme_members_theme_name", "theme_members", ["theme_name"])


def downgrade() -> None:
    op.drop_table("theme_members")
