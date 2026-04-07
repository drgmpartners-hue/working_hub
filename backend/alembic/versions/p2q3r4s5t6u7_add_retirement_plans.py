"""add retirement_plans table.

Revision ID: p2q3r4s5t6u7
Revises: o1p2q3r4s5t6
Create Date: 2026-04-07 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic
revision = "p2q3r4s5t6u7"
down_revision = "o1p2q3r4s5t6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "retirement_plans",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "profile_id",
            sa.String(36),
            sa.ForeignKey("customer_retirement_profiles.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("current_age", sa.Integer(), nullable=False),
        sa.Column("lump_sum_amount", sa.BigInteger(), nullable=True),
        sa.Column("annual_savings", sa.BigInteger(), nullable=True),
        sa.Column("saving_period_years", sa.Integer(), nullable=True),
        sa.Column("inflation_rate", sa.Numeric(5, 2), nullable=True),
        sa.Column("annual_return_rate", sa.Numeric(5, 2), nullable=False),
        sa.Column("target_retirement_fund", sa.BigInteger(), nullable=True),
        sa.Column("target_pension_amount", sa.BigInteger(), nullable=True),
        sa.Column("desired_retirement_age", sa.Integer(), nullable=True),
        sa.Column("possible_retirement_age", sa.Integer(), nullable=True),
        sa.Column(
            "inheritance_consideration",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column("yearly_projections", postgresql.JSONB(), nullable=True),
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
        "ix_retirement_plans_profile_id",
        "retirement_plans",
        ["profile_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_retirement_plans_profile_id", table_name="retirement_plans")
    op.drop_table("retirement_plans")
