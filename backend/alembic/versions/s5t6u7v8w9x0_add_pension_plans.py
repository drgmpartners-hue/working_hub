"""add pension_plans table.

Revision ID: s5t6u7v8w9x0
Revises: r4s5t6u7v8w9
Create Date: 2026-04-07 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic
revision = "s5t6u7v8w9x0"
down_revision = "r4s5t6u7v8w9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "pension_plans",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "profile_id",
            sa.String(36),
            sa.ForeignKey("customer_retirement_profiles.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("pension_type", sa.String(20), nullable=False),
        sa.Column("accumulation_summary", postgresql.JSONB(), nullable=True),
        sa.Column("distribution_plan", postgresql.JSONB(), nullable=True),
        sa.Column("combined_graph_data", postgresql.JSONB(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_pension_plans_profile_id",
        "pension_plans",
        ["profile_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_pension_plans_profile_id", table_name="pension_plans")
    op.drop_table("pension_plans")
