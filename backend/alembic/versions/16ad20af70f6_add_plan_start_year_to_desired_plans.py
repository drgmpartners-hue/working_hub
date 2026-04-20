"""add plan_start_year to desired_plans

Revision ID: 16ad20af70f6
Revises: u7v8w9x0y1z2
Create Date: 2026-04-20 15:23:47.744810
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '16ad20af70f6'
down_revision: Union[str, None] = 'u7v8w9x0y1z2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    op.add_column('desired_plans', sa.Column('plan_start_year', sa.Integer(), nullable=True, comment='플랜 시작연도'))

def downgrade() -> None:
    op.drop_column('desired_plans', 'plan_start_year')
