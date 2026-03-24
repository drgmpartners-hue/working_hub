"""add_client_unique_code_ssn

Revision ID: f2a3b4c5d6e7
Revises: e1f2a3b4c5d6
Create Date: 2026-03-24 00:00:00.000000
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = 'f2a3b4c5d6e7'
down_revision: Union[str, None] = 'e1f2a3b4c5d6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('clients', sa.Column('unique_code', sa.String(6), nullable=True))
    op.add_column('clients', sa.Column('ssn_encrypted', sa.String(500), nullable=True))
    op.create_unique_constraint('uq_clients_unique_code', 'clients', ['unique_code'])
    op.create_index('ix_clients_unique_code', 'clients', ['unique_code'])


def downgrade() -> None:
    op.drop_index('ix_clients_unique_code', table_name='clients')
    op.drop_constraint('uq_clients_unique_code', 'clients', type_='unique')
    op.drop_column('clients', 'ssn_encrypted')
    op.drop_column('clients', 'unique_code')
