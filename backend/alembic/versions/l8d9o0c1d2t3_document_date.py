"""자료함 문서의 자료 날짜 (2026-10-08) — 반기 보고서가 대상 기간에 맞는 자료만 쓰도록.

Revision ID: l8d9o0c1d2t3
Revises: k7r8v9w0e1r2
"""
from alembic import op
import sqlalchemy as sa

revision = "l8d9o0c1d2t3"
down_revision = "k7r8v9w0e1r2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("company_documents", sa.Column("doc_date", sa.Date(), nullable=True))
    op.add_column("company_documents", sa.Column("doc_date_source", sa.String(10), nullable=True))


def downgrade() -> None:
    op.drop_column("company_documents", "doc_date_source")
    op.drop_column("company_documents", "doc_date")
