"""add_recommended_portfolio_items

Revision ID: e1f2a3b4c5d6
Revises: 9da2688a7673
Create Date: 2026-03-24 00:00:00.000000
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = 'e1f2a3b4c5d6'
down_revision: Union[str, None] = '9da2688a7673'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'recommended_portfolio_items',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('product_name', sa.String(300), nullable=False),
        sa.Column('product_code', sa.String(50), nullable=True),
        sa.Column('product_type', sa.String(100), nullable=True),
        sa.Column('region', sa.String(50), nullable=True),
        sa.Column('current_price', sa.Float(), nullable=True),
        sa.Column('weight_pension', sa.Float(), nullable=True),
        sa.Column('weight_irp', sa.Float(), nullable=True),
        sa.Column('memo', sa.String(500), nullable=True),
        sa.Column('seq', sa.Integer(), nullable=False, server_default='0'),
        sa.Column(
            'created_at',
            sa.DateTime(),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.Column(
            'updated_at',
            sa.DateTime(),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint('id'),
    )


def downgrade() -> None:
    op.drop_table('recommended_portfolio_items')
