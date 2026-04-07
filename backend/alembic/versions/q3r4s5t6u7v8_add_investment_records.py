"""add investment_records table.

Revision ID: q3r4s5t6u7v8
Revises: p2q3r4s5t6u7
Create Date: 2026-04-07 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic
revision = "q3r4s5t6u7v8"
down_revision = "p2q3r4s5t6u7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "investment_records",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "profile_id",
            sa.String(36),
            sa.ForeignKey(
                "customer_retirement_profiles.id", ondelete="CASCADE"
            ),
            nullable=False,
        ),
        sa.Column(
            "wrap_account_id",
            sa.Integer(),
            sa.ForeignKey("wrap_accounts.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("record_type", sa.String(20), nullable=False),
        sa.Column("product_name", sa.String(100), nullable=True),
        sa.Column("investment_amount", sa.BigInteger(), nullable=False),
        sa.Column("evaluation_amount", sa.BigInteger(), nullable=True),
        sa.Column("return_rate", sa.Numeric(5, 2), nullable=True),
        sa.Column("status", sa.String(10), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column(
            "predecessor_id",
            sa.Integer(),
            sa.ForeignKey("investment_records.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "successor_id",
            sa.Integer(),
            sa.ForeignKey("investment_records.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("memo", sa.Text(), nullable=True),
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
        "ix_investment_records_profile_id",
        "investment_records",
        ["profile_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_investment_records_profile_id", table_name="investment_records")
    op.drop_table("investment_records")
