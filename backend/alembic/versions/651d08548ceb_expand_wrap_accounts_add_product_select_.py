"""expand_wrap_accounts_add_product_select_options

Revision ID: 651d08548ceb
Revises: 8af06683492d
Create Date: 2026-04-30 11:44:37.304233
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '651d08548ceb'
down_revision: Union[str, None] = '8af06683492d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    # 1. product_select_options 테이블 생성
    op.create_table('product_select_options',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('field_name', sa.String(length=30), nullable=False),
        sa.Column('option_value', sa.String(length=100), nullable=False),
        sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_product_select_options_field_name', 'product_select_options', ['field_name'])

    # 2. wrap_accounts 컬럼 확장
    op.alter_column('wrap_accounts', 'product_name',
        existing_type=sa.VARCHAR(length=100), type_=sa.String(length=200), existing_nullable=False)
    op.alter_column('wrap_accounts', 'securities_company',
        existing_type=sa.VARCHAR(length=50), type_=sa.String(length=100), nullable=True)

    op.add_column('wrap_accounts', sa.Column('in_out', sa.String(length=10), nullable=True))
    op.add_column('wrap_accounts', sa.Column('category', sa.String(length=50), nullable=True))
    op.add_column('wrap_accounts', sa.Column('asset_class_1', sa.String(length=50), nullable=True))
    op.add_column('wrap_accounts', sa.Column('asset_class_2', sa.String(length=50), nullable=True))
    op.add_column('wrap_accounts', sa.Column('institution', sa.String(length=100), nullable=True))
    op.add_column('wrap_accounts', sa.Column('period', sa.String(length=30), nullable=True))
    op.add_column('wrap_accounts', sa.Column('risk_level', sa.String(length=20), nullable=True))
    op.add_column('wrap_accounts', sa.Column('currency', sa.String(length=5), nullable=True))
    op.add_column('wrap_accounts', sa.Column('total_expected_return', sa.Numeric(precision=7, scale=2), nullable=True))
    op.add_column('wrap_accounts', sa.Column('annual_expected_return', sa.Numeric(precision=5, scale=2), nullable=True))
    for i in range(1, 11):
        op.add_column('wrap_accounts', sa.Column(f'port_{i}', sa.String(length=100), nullable=True))

    # 3. 기존 데이터 매핑: securities_company → institution
    op.execute("UPDATE wrap_accounts SET institution = securities_company WHERE institution IS NULL AND securities_company IS NOT NULL")
    op.execute("UPDATE wrap_accounts SET annual_expected_return = target_return_rate WHERE annual_expected_return IS NULL AND target_return_rate IS NOT NULL")

def downgrade() -> None:
    for i in range(10, 0, -1):
        op.drop_column('wrap_accounts', f'port_{i}')
    op.drop_column('wrap_accounts', 'annual_expected_return')
    op.drop_column('wrap_accounts', 'total_expected_return')
    op.drop_column('wrap_accounts', 'currency')
    op.drop_column('wrap_accounts', 'risk_level')
    op.drop_column('wrap_accounts', 'period')
    op.drop_column('wrap_accounts', 'institution')
    op.drop_column('wrap_accounts', 'asset_class_2')
    op.drop_column('wrap_accounts', 'asset_class_1')
    op.drop_column('wrap_accounts', 'category')
    op.drop_column('wrap_accounts', 'in_out')
    op.alter_column('wrap_accounts', 'securities_company',
        existing_type=sa.String(length=100), type_=sa.VARCHAR(length=50), nullable=False)
    op.alter_column('wrap_accounts', 'product_name',
        existing_type=sa.String(length=200), type_=sa.VARCHAR(length=100), existing_nullable=False)
    op.drop_index('ix_product_select_options_field_name', table_name='product_select_options')
    op.drop_table('product_select_options')
