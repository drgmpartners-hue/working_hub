"""add interactive_calculations table.

Revision ID: r4s5t6u7v8w9
Revises: q3r4s5t6u7v8
Create Date: 2026-04-07 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic
revision = "r4s5t6u7v8w9"
down_revision = "q3r4s5t6u7v8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "interactive_calculations",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "profile_id",
            sa.String(36),
            sa.ForeignKey(
                "customer_retirement_profiles.id", ondelete="CASCADE"
            ),
            nullable=False,
        ),
        sa.Column("plan_year", sa.Integer(), nullable=False),
        sa.Column("actual_data", JSONB(), nullable=True),
        sa.Column("projected_data", JSONB(), nullable=True),
        sa.Column("deviation_rate", sa.Numeric(5, 2), nullable=True),
        sa.Column("ai_guide_result", sa.Text(), nullable=True),
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
        "ix_interactive_calculations_profile_id",
        "interactive_calculations",
        ["profile_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_interactive_calculations_profile_id",
        table_name="interactive_calculations",
    )
    op.drop_table("interactive_calculations")
