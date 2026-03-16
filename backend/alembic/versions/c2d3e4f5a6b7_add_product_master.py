"""add_product_master

Revision ID: c2d3e4f5a6b7
Revises: b1c2d3e4f5a6
Create Date: 2026-03-16 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'c2d3e4f5a6b7'
down_revision = 'b1c2d3e4f5a6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'product_master',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('product_name', sa.String(300), nullable=False),
        sa.Column('product_code', sa.String(50), nullable=True),
        sa.Column('risk_level', sa.String(50), nullable=True),
        sa.Column('region', sa.String(50), nullable=True),
        sa.Column('product_type', sa.String(100), nullable=True),
        sa.Column(
            'created_at',
            sa.DateTime(),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            'updated_at',
            sa.DateTime(),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('product_name', name='uq_product_master_product_name'),
    )
    op.create_index(
        'ix_product_master_product_name',
        'product_master',
        ['product_name'],
    )


def downgrade() -> None:
    op.drop_index('ix_product_master_product_name', table_name='product_master')
    op.drop_table('product_master')
