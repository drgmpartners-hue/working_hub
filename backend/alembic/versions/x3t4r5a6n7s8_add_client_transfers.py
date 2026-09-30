"""권한체계: client_transfers 테이블 (docs/login_logic P1-4).

Revision ID: x3t4r5a6n7s8
Revises: w2a3u4d5i6t7
Create Date: 2026-09-30 13:02:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = "x3t4r5a6n7s8"
down_revision = "w2a3u4d5i6t7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "client_transfers",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("client_id", sa.String(36), sa.ForeignKey("clients.id", ondelete="CASCADE"), nullable=False),
        sa.Column("from_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("to_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("performed_by_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("reason", sa.String(300), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_client_transfers_client_id", "client_transfers", ["client_id"])


def downgrade() -> None:
    op.drop_index("ix_client_transfers_client_id", table_name="client_transfers")
    op.drop_table("client_transfers")
