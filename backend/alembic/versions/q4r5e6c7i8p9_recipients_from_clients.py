"""기업 리포트: 브리핑 수신자를 고객 정보 관리(clients)에서도 고를 수 있게.

Revision ID: q4r5e6c7i8p9
Revises: p3d4e5l6e7t8
Create Date: 2026-09-29 09:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = "q4r5e6c7i8p9"
down_revision = "p3d4e5l6e7t8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("briefing_recipients", "user_id", existing_type=sa.String(36), nullable=True)
    op.add_column("briefing_recipients", sa.Column("client_id", sa.String(36), nullable=True))
    op.add_column("briefing_recipients", sa.Column("name", sa.String(100), nullable=True))
    op.create_foreign_key("fk_briefing_recipients_client", "briefing_recipients", "clients", ["client_id"], ["id"], ondelete="CASCADE")
    op.create_unique_constraint("uq_briefing_recipients_client", "briefing_recipients", ["client_id"])


def downgrade() -> None:
    op.execute("DELETE FROM briefing_recipients WHERE user_id IS NULL")
    op.drop_constraint("uq_briefing_recipients_client", "briefing_recipients", type_="unique")
    op.drop_constraint("fk_briefing_recipients_client", "briefing_recipients", type_="foreignkey")
    op.drop_column("briefing_recipients", "name")
    op.drop_column("briefing_recipients", "client_id")
    op.alter_column("briefing_recipients", "user_id", existing_type=sa.String(36), nullable=False)
