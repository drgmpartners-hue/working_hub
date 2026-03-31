"""add user phone and suggestion created_by

Revision ID: l8m9n0o1p2q3
Revises: k7l8m9n0o1p2
Create Date: 2026-03-31
"""
from alembic import op
import sqlalchemy as sa

revision = "l8m9n0o1p2q3"
down_revision = "k7l8m9n0o1p2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("phone", sa.String(20), nullable=True))
    op.add_column("portfolio_suggestions", sa.Column("created_by", sa.String(36), nullable=True))


def downgrade() -> None:
    op.drop_column("portfolio_suggestions", "created_by")
    op.drop_column("users", "phone")
