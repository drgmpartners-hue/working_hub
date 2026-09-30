"""기업 리포트: 발송 기록에 받은 사람 이름.

Revision ID: u8r9e0c1n2m3
Revises: t7a8u9t0o1s2
Create Date: 2026-09-30 10:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = "u8r9e0c1n2m3"
down_revision = "t7a8u9t0o1s2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("briefing_send_logs", sa.Column("recipient_name", sa.String(100), nullable=True))


def downgrade() -> None:
    op.drop_column("briefing_send_logs", "recipient_name")
