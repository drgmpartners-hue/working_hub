"""add_market_analysis_cache

Revision ID: g3h4i5j6k7l8
Revises: f2a3b4c5d6e7
Create Date: 2026-03-24 00:00:00.000000
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = "g3h4i5j6k7l8"
down_revision: Union[str, None] = "f2a3b4c5d6e7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "market_analysis_cache",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("keyword", sa.String(100), nullable=False),
        sa.Column("news_summary", sa.Text(), nullable=False),
        sa.Column("analysis", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("keyword"),
    )
    op.create_index(
        "ix_market_analysis_cache_keyword",
        "market_analysis_cache",
        ["keyword"],
    )


def downgrade() -> None:
    op.drop_index("ix_market_analysis_cache_keyword", table_name="market_analysis_cache")
    op.drop_table("market_analysis_cache")
