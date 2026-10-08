"""반기 보고서 검토 담당·공식본 (2026-10-08).

- company_members.is_reviewer: 대표가 기업마다 지정한 검토 담당
- company_reports.official: 검토 담당이 [검토 완료]한 버전(그 기업의 공식본)

Revision ID: k7r8v9w0e1r2
Revises: j6m7a8r9c0h1
"""
from alembic import op
import sqlalchemy as sa

revision = "k7r8v9w0e1r2"
down_revision = "j6m7a8r9c0h1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("company_members", sa.Column("is_reviewer", sa.Boolean(), server_default=sa.false(), nullable=False))
    op.add_column("company_reports", sa.Column("official", sa.Boolean(), server_default=sa.false(), nullable=False))


def downgrade() -> None:
    op.drop_column("company_reports", "official")
    op.drop_column("company_members", "is_reviewer")
