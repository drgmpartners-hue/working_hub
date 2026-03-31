"""add suggestion manager_note

Revision ID: m9n0o1p2q3r4
Revises: l8m9n0o1p2q3
Create Date: 2026-03-31
"""
from alembic import op
import sqlalchemy as sa

revision = "m9n0o1p2q3r4"
down_revision = "l8m9n0o1p2q3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("portfolio_suggestions", sa.Column("manager_note", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("portfolio_suggestions", "manager_note")
