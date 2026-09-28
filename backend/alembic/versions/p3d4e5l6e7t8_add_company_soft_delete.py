"""기업 리포트: 투자기업 2단계 삭제(1단계 화면에서 삭제 표시).

Revision ID: p3d4e5l6e7t8
Revises: o2c3r4p5t6u7
Create Date: 2026-09-28 18:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = "p3d4e5l6e7t8"
down_revision = "o2c3r4p5t6u7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("portfolio_companies", sa.Column("deleted_at", sa.DateTime(), nullable=True))
    op.add_column("portfolio_companies", sa.Column("deleted_by", sa.String(36), nullable=True))
    op.create_index("ix_portfolio_companies_deleted_at", "portfolio_companies", ["deleted_at"])


def downgrade() -> None:
    op.drop_index("ix_portfolio_companies_deleted_at", table_name="portfolio_companies")
    op.drop_column("portfolio_companies", "deleted_by")
    op.drop_column("portfolio_companies", "deleted_at")
