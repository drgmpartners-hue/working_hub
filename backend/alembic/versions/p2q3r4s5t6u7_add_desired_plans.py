"""add desired_plans table

Revision ID: a1b2c3d4e5f6
Revises: q3r4s5t6u7v8
Create Date: 2026-04-07
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "a1b2c3d4e5f6"
down_revision = "q3r4s5t6u7v8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "desired_plans",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "profile_id",
            sa.String(36),
            sa.ForeignKey("customer_retirement_profiles.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("monthly_desired_amount", sa.BigInteger(), nullable=False),
        sa.Column("retirement_period_years", sa.Integer(), nullable=False),
        sa.Column("target_total_fund", sa.BigInteger(), nullable=True),
        sa.Column("required_lump_sum", sa.BigInteger(), nullable=True),
        sa.Column("required_annual_savings", sa.BigInteger(), nullable=True),
        sa.Column("calculation_params", postgresql.JSONB(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_desired_plans_profile_id",
        "desired_plans",
        ["profile_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_desired_plans_profile_id", table_name="desired_plans")
    op.drop_table("desired_plans")
