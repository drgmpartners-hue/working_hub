"""add product_name_changes table

Revision ID: k7l8m9n0o1p2
Revises: j6k7l8m9n0o1_add_field_options_representative
Create Date: 2026-03-30
"""
from alembic import op
import sqlalchemy as sa

revision = "k7l8m9n0o1p2"
down_revision = "j6k7l8m9n0o1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "product_name_changes",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("old_keyword", sa.String(200), nullable=False, index=True),
        sa.Column("new_keyword", sa.String(200), nullable=False),
        sa.Column("memo", sa.String(500), nullable=True),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime, server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("product_name_changes")
