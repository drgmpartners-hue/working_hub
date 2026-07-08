"""customer_retirement_profiles.customer_id FK: users.id → clients.id

과거 FK가 users.id를 가리켜, 고객(clients.id)으로는 프로필 생성이 항상 실패했음.
고객별 은퇴 프로필이 되도록 clients.id로 교체한다.

Revision ID: e8f9a0b1c2d3
Revises: d7e8f9a0b1c2
Create Date: 2026-07-08 00:00:00.000000
"""
from alembic import op

revision = "e8f9a0b1c2d3"
down_revision = "d7e8f9a0b1c2"
branch_labels = None
depends_on = None

_FK = "customer_retirement_profiles_customer_id_fkey"
_TABLE = "customer_retirement_profiles"


def upgrade() -> None:
    # 1) clients에 없는 customer_id(과거 users.id 기준으로 저장된 행 등) 정리 → 새 FK 위반 방지
    op.execute(
        f"DELETE FROM {_TABLE} WHERE customer_id NOT IN (SELECT id FROM clients)"
    )
    # 2) users.id FK 제거 → clients.id FK로 재생성
    op.drop_constraint(_FK, _TABLE, type_="foreignkey")
    op.create_foreign_key(
        _FK, _TABLE, "clients", ["customer_id"], ["id"], ondelete="CASCADE"
    )


def downgrade() -> None:
    op.drop_constraint(_FK, _TABLE, type_="foreignkey")
    op.create_foreign_key(
        _FK, _TABLE, "users", ["customer_id"], ["id"], ondelete="CASCADE"
    )
