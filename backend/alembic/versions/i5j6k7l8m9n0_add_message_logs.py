"""add_message_logs

Revision ID: i5j6k7l8m9n0
Revises: h4i5j6k7l8m9
Create Date: 2026-03-27 00:00:00.000000
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = "i5j6k7l8m9n0"
down_revision: Union[str, None] = "h4i5j6k7l8m9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "message_logs",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("user_id", sa.String(36), nullable=False),
        sa.Column("client_id", sa.String(36), nullable=False),
        sa.Column("client_account_id", sa.String(36), nullable=True),
        sa.Column("message_type", sa.String(30), nullable=False),
        sa.Column("message_summary", sa.String(200), nullable=False),
        sa.Column("message_text", sa.Text(), nullable=True),
        sa.Column("image_path", sa.String(500), nullable=True),
        sa.Column("sent_at", sa.DateTime(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["client_id"], ["clients.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["client_account_id"], ["client_accounts.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_message_logs_user_id", "message_logs", ["user_id"])
    op.create_index("ix_message_logs_client_id", "message_logs", ["client_id"])
    op.create_index(
        "ix_message_logs_client_account_id", "message_logs", ["client_account_id"]
    )
    op.create_index("ix_message_logs_sent_at", "message_logs", ["sent_at"])


def downgrade() -> None:
    op.drop_index("ix_message_logs_sent_at", table_name="message_logs")
    op.drop_index("ix_message_logs_client_account_id", table_name="message_logs")
    op.drop_index("ix_message_logs_client_id", table_name="message_logs")
    op.drop_index("ix_message_logs_user_id", table_name="message_logs")
    op.drop_table("message_logs")
