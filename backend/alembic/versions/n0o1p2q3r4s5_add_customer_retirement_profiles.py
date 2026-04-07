"""add customer_retirement_profiles table

Revision ID: n0o1p2q3r4s5
Revises: m9n0o1p2q3r4
Create Date: 2026-04-07
"""
from alembic import op
import sqlalchemy as sa

revision = "n0o1p2q3r4s5"
down_revision = "m9n0o1p2q3r4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "customer_retirement_profiles",
        sa.Column("id", sa.String(36), primary_key=True, nullable=False),
        sa.Column(
            "customer_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("target_retirement_fund", sa.BigInteger(), nullable=False),
        sa.Column("desired_pension_amount", sa.BigInteger(), nullable=False),
        sa.Column("age_at_design", sa.Integer(), nullable=False),
        sa.Column("current_age", sa.Integer(), nullable=False),
        sa.Column("desired_retirement_age", sa.Integer(), nullable=False),
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
        "ix_customer_retirement_profiles_customer_id",
        "customer_retirement_profiles",
        ["customer_id"],
        unique=True,
    )
    op.create_unique_constraint(
        "uq_customer_retirement_profile_customer",
        "customer_retirement_profiles",
        ["customer_id"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_customer_retirement_profile_customer",
        "customer_retirement_profiles",
        type_="unique",
    )
    op.drop_index(
        "ix_customer_retirement_profiles_customer_id",
        table_name="customer_retirement_profiles",
    )
    op.drop_table("customer_retirement_profiles")
