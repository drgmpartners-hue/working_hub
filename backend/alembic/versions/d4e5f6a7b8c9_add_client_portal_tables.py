"""add_client_portal_tables

Revision ID: d4e5f6a7b8c9
Revises: c2d3e4f5a6b7
Create Date: 2026-03-16 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = 'd4e5f6a7b8c9'
down_revision = 'c2d3e4f5a6b7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add columns to clients table
    op.add_column('clients', sa.Column('birth_date', sa.Date(), nullable=True))
    op.add_column('clients', sa.Column('phone', sa.String(20), nullable=True))
    op.add_column('clients', sa.Column('email', sa.String(200), nullable=True))
    op.add_column(
        'clients',
        sa.Column('portal_token', sa.String(36), nullable=True, unique=True),
    )

    # Create portfolio_suggestions table
    op.create_table(
        'portfolio_suggestions',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('account_id', sa.String(36), nullable=False),
        sa.Column('snapshot_id', sa.String(36), nullable=False),
        sa.Column('suggested_weights', JSONB(), nullable=False),
        sa.Column('ai_comment', sa.Text(), nullable=True),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=True),
        sa.ForeignKeyConstraint(['account_id'], ['client_accounts.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )

    # Create call_reservations table
    op.create_table(
        'call_reservations',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('suggestion_id', sa.String(36), nullable=True),
        sa.Column('client_name', sa.String(100), nullable=True),
        sa.Column('phone', sa.String(20), nullable=True),
        sa.Column('preferred_date', sa.Date(), nullable=False),
        sa.Column('preferred_time', sa.String(20), nullable=False),
        sa.Column('status', sa.String(20), nullable=True, server_default='pending'),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=True),
        sa.ForeignKeyConstraint(['suggestion_id'], ['portfolio_suggestions.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )


def downgrade() -> None:
    op.drop_table('call_reservations')
    op.drop_table('portfolio_suggestions')
    op.drop_column('clients', 'portal_token')
    op.drop_column('clients', 'email')
    op.drop_column('clients', 'phone')
    op.drop_column('clients', 'birth_date')
