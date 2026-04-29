"""add interim_evaluations to investment_records

Revision ID: 8af06683492d
Revises: 16ad20af70f6
Create Date: 2026-04-27 17:05:02.106899
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '8af06683492d'
down_revision: Union[str, None] = '16ad20af70f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    op.add_column('investment_records', sa.Column('interim_evaluations', sa.JSON(), nullable=True))

def downgrade() -> None:
    op.drop_column('investment_records', 'interim_evaluations')
