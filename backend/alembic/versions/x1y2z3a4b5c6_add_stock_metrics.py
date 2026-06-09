"""add stock_daily_metrics and score_snapshots tables.

Revision ID: x1y2z3a4b5c6
Revises: 651d08548ceb
Create Date: 2026-06-09 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "x1y2z3a4b5c6"
down_revision = "651d08548ceb"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "stock_daily_metrics",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("code", sa.String(20), nullable=False),
        sa.Column("name", sa.String(100), nullable=True),
        sa.Column("trade_date", sa.Date(), nullable=False),
        sa.Column("close", sa.Float(), nullable=True),
        sa.Column("ma5", sa.Float(), nullable=True),
        sa.Column("ma20", sa.Float(), nullable=True),
        sa.Column("ma60", sa.Float(), nullable=True),
        sa.Column("ma120", sa.Float(), nullable=True),
        sa.Column("ma_alignment", sa.String(10), nullable=True),
        sa.Column("golden_cross", sa.Boolean(), nullable=True),
        sa.Column("dead_cross", sa.Boolean(), nullable=True),
        sa.Column("per", sa.Float(), nullable=True),
        sa.Column("pbr", sa.Float(), nullable=True),
        sa.Column("roe", sa.Float(), nullable=True),
        sa.Column("foreign_net", sa.BigInteger(), nullable=True),
        sa.Column("institution_net", sa.BigInteger(), nullable=True),
        sa.Column("composite_score", sa.Float(), nullable=True),
        sa.Column("valuation", sa.Float(), nullable=True),
        sa.Column("momentum", sa.Float(), nullable=True),
        sa.Column("supply", sa.Float(), nullable=True),
        sa.Column("phase", sa.String(12), nullable=True),
        sa.Column("return_1m", sa.Float(), nullable=True),
        sa.Column("return_3m", sa.Float(), nullable=True),
        sa.Column("return_6m", sa.Float(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code", "trade_date", name="uq_metric_code_date"),
    )
    op.create_index("ix_stock_daily_metrics_code", "stock_daily_metrics", ["code"])
    op.create_index("ix_stock_daily_metrics_trade_date", "stock_daily_metrics", ["trade_date"])
    op.create_index("ix_stock_daily_metrics_composite_score", "stock_daily_metrics", ["composite_score"])
    op.create_index("ix_metric_screen", "stock_daily_metrics", ["trade_date", "composite_score"])

    op.create_table(
        "score_snapshots",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("code", sa.String(20), nullable=False),
        sa.Column("snapshot_date", sa.Date(), nullable=False),
        sa.Column("momentum", sa.Float(), nullable=True),
        sa.Column("supply", sa.Float(), nullable=True),
        sa.Column("valuation", sa.Float(), nullable=True),
        sa.Column("fundamentals", sa.Float(), nullable=True),
        sa.Column("composite", sa.Float(), nullable=True),
        sa.Column("phase", sa.String(12), nullable=True),
        sa.Column("entry_price", sa.Float(), nullable=True),
        sa.Column("horizon_return", sa.Float(), nullable=True),
        sa.Column("measured_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code", "snapshot_date", name="uq_snapshot_code_date"),
    )
    op.create_index("ix_score_snapshots_code", "score_snapshots", ["code"])
    op.create_index("ix_score_snapshots_snapshot_date", "score_snapshots", ["snapshot_date"])


def downgrade() -> None:
    op.drop_table("score_snapshots")
    op.drop_table("stock_daily_metrics")
