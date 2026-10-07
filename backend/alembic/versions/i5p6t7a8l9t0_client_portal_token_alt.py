"""clients.portal_token_alt — 중복 고객을 합칠 때 지운 쪽 포털 링크를 남겨 그 링크도 계속 열리게 (2026-10-07).

Revision ID: i5p6t7a8l9t0
Revises: h4m5g6r7k8e9
"""
from alembic import op
import sqlalchemy as sa

revision = "i5p6t7a8l9t0"
down_revision = "h4m5g6r7k8e9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("clients", sa.Column("portal_token_alt", sa.String(36), nullable=True))
    op.create_unique_constraint("uq_clients_portal_token_alt", "clients", ["portal_token_alt"])


def downgrade() -> None:
    op.drop_constraint("uq_clients_portal_token_alt", "clients", type_="unique")
    op.drop_column("clients", "portal_token_alt")
