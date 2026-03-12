"""add_client_portfolio_v2

Revision ID: b1c2d3e4f5a6
Revises: 382438d6a70e
Create Date: 2026-03-12 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'b1c2d3e4f5a6'
down_revision = '382438d6a70e'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'clients',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('user_id', sa.String(36), nullable=False),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('memo', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_clients_user_id', 'clients', ['user_id'])

    op.create_table(
        'client_accounts',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('client_id', sa.String(36), nullable=False),
        sa.Column('account_type', sa.String(20), nullable=False),
        sa.Column('account_number', sa.String(100), nullable=True),
        sa.Column('securities_company', sa.String(100), nullable=True),
        sa.Column('monthly_payment', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['client_id'], ['clients.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_client_accounts_client_id', 'client_accounts', ['client_id'])

    op.create_table(
        'portfolio_snapshots',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('client_account_id', sa.String(36), nullable=False),
        sa.Column('snapshot_date', sa.Date(), nullable=False),
        sa.Column('image_path', sa.String(500), nullable=True),
        sa.Column('parsed_data', postgresql.JSONB(), nullable=True),
        sa.Column('deposit_amount', sa.Float(), nullable=True),
        sa.Column('total_purchase', sa.Float(), nullable=True),
        sa.Column('total_evaluation', sa.Float(), nullable=True),
        sa.Column('total_return', sa.Float(), nullable=True),
        sa.Column('total_return_rate', sa.Float(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['client_account_id'], ['client_accounts.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_portfolio_snapshots_account_id', 'portfolio_snapshots', ['client_account_id'])

    op.create_table(
        'portfolio_holdings',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('snapshot_id', sa.String(36), nullable=False),
        sa.Column('product_name', sa.String(200), nullable=False),
        sa.Column('product_code', sa.String(50), nullable=True),
        sa.Column('product_type', sa.String(100), nullable=True),
        sa.Column('risk_level', sa.String(50), nullable=True),
        sa.Column('region', sa.String(50), nullable=True),
        sa.Column('purchase_amount', sa.Float(), nullable=True),
        sa.Column('evaluation_amount', sa.Float(), nullable=True),
        sa.Column('return_amount', sa.Float(), nullable=True),
        sa.Column('return_rate', sa.Float(), nullable=True),
        sa.Column('weight', sa.Float(), nullable=True),
        sa.Column('reference_price', sa.Float(), nullable=True),
        sa.Column('seq', sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(['snapshot_id'], ['portfolio_snapshots.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_portfolio_holdings_snapshot_id', 'portfolio_holdings', ['snapshot_id'])


def downgrade() -> None:
    op.drop_index('ix_portfolio_holdings_snapshot_id', table_name='portfolio_holdings')
    op.drop_table('portfolio_holdings')
    op.drop_index('ix_portfolio_snapshots_account_id', table_name='portfolio_snapshots')
    op.drop_table('portfolio_snapshots')
    op.drop_index('ix_client_accounts_client_id', table_name='client_accounts')
    op.drop_table('client_accounts')
    op.drop_index('ix_clients_user_id', table_name='clients')
    op.drop_table('clients')
