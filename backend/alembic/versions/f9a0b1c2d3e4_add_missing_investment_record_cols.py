"""investment_records 누락 컬럼 5개 보강.

모델에는 있으나 마이그레이션이 없어 운영 DB에만 수동 DDL로 존재하던 컬럼들.
새 환경에서 `alembic upgrade head` 시 UndefinedColumn으로 예수금 연동 전체가
죽는 시한폭탄을 제거한다. 기존 DB에 이미 있으므로 IF NOT EXISTS로 안전 처리.

Revision ID: f9a0b1c2d3e4
Revises: e8f9a0b1c2d3
"""
from alembic import op

revision = "f9a0b1c2d3e4"
down_revision = "e8f9a0b1c2d3"
branch_labels = None
depends_on = None

_COLUMNS = [
    ("deposit_account_id", "INTEGER"),
    ("join_date", "DATE"),
    ("expected_maturity_date", "DATE"),
    ("actual_maturity_date", "DATE"),
    ("original_maturity_date", "DATE"),
]


def upgrade() -> None:
    for name, coltype in _COLUMNS:
        op.execute(
            f"ALTER TABLE investment_records ADD COLUMN IF NOT EXISTS {name} {coltype}"
        )


def downgrade() -> None:
    for name, _ in reversed(_COLUMNS):
        op.execute(f"ALTER TABLE investment_records DROP COLUMN IF EXISTS {name}")
