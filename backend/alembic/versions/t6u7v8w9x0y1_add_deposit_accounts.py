"""add deposit_accounts and deposit_transactions tables.

Revision ID: t6u7v8w9x0y1
Revises: s5t6u7v8w9x0
Create Date: 2026-04-08 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "t6u7v8w9x0y1"
down_revision = "s5t6u7v8w9x0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # deposit_accounts
    # ------------------------------------------------------------------
    op.create_table(
        "deposit_accounts",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("profile_id", sa.String(36), nullable=False),
        sa.Column("customer_id", sa.String(36), nullable=False),
        sa.Column("securities_company", sa.String(100), nullable=False),
        sa.Column("account_number", sa.String(50), nullable=True),
        sa.Column("nickname", sa.String(100), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_deposit_accounts_profile_id",
        "deposit_accounts",
        ["profile_id"],
    )
    op.create_index(
        "ix_deposit_accounts_customer_id",
        "deposit_accounts",
        ["customer_id"],
    )

    # ------------------------------------------------------------------
    # deposit_transactions
    # ------------------------------------------------------------------
    op.create_table(
        "deposit_transactions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("deposit_account_id", sa.Integer(), nullable=False),
        sa.Column("transaction_date", sa.Date(), nullable=False),
        sa.Column("transaction_type", sa.String(20), nullable=False),
        sa.Column("related_product", sa.String(200), nullable=True),
        sa.Column("investment_record_id", sa.Integer(), nullable=True),
        sa.Column(
            "credit_amount", sa.BigInteger(), nullable=False, server_default=sa.text("0")
        ),
        sa.Column(
            "debit_amount", sa.BigInteger(), nullable=False, server_default=sa.text("0")
        ),
        sa.Column(
            "balance", sa.BigInteger(), nullable=False, server_default=sa.text("0")
        ),
        sa.Column("memo", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["deposit_account_id"],
            ["deposit_accounts.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_deposit_transactions_deposit_account_id",
        "deposit_transactions",
        ["deposit_account_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_deposit_transactions_deposit_account_id",
        table_name="deposit_transactions",
    )
    op.drop_table("deposit_transactions")

    op.drop_index("ix_deposit_accounts_customer_id", table_name="deposit_accounts")
    op.drop_index("ix_deposit_accounts_profile_id", table_name="deposit_accounts")
    op.drop_table("deposit_accounts")
