"""Add field_options table and representative column to client_accounts

Revision ID: j6k7l8m9n0o1
Revises: i5j6k7l8m9n0
Create Date: 2026-03-27

"""
from alembic import op
import sqlalchemy as sa

revision = "j6k7l8m9n0o1"
down_revision = "i5j6k7l8m9n0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add representative column to client_accounts
    op.add_column("client_accounts", sa.Column("representative", sa.String(100), nullable=True))

    # Create field_options table
    op.create_table(
        "field_options",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("field_name", sa.String(50), nullable=False, index=True),
        sa.Column("value", sa.String(100), nullable=False),
        sa.Column("label", sa.String(100), nullable=False),
        sa.Column("sort_order", sa.Integer, default=0),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("field_options")
    op.drop_column("client_accounts", "representative")
