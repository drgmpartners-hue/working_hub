"""deposit_transactions에 적립액(savings_amount) 컬럼 추가

자동이체 등 정기 적립 입금을 입금액과 구분해 기록한다. 잔액 = 입금 + 적립 - 출금.

Revision ID: b7c8d9e0f1a2
Revises: f9a0b1c2d3e4
Create Date: 2026-08-04
"""
from alembic import op

# revision identifiers, used by Alembic.
revision = "b7c8d9e0f1a2"
down_revision = "f9a0b1c2d3e4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 기존 운영 DB와의 충돌 방지를 위해 IF NOT EXISTS 사용
    op.execute(
        "ALTER TABLE deposit_transactions "
        "ADD COLUMN IF NOT EXISTS savings_amount BIGINT NOT NULL DEFAULT 0"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE deposit_transactions DROP COLUMN IF EXISTS savings_amount")
