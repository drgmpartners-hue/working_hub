"""add score_detail (JSON) to stock_themes — 5축 집계 결과 저장.

Revision ID: a4b5c6d7e8f9
Revises: z3a4b5c6d7e8
Create Date: 2026-06-10 06:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "a4b5c6d7e8f9"
down_revision = "z3a4b5c6d7e8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("stock_themes", sa.Column("score_detail", JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("stock_themes", "score_detail")
