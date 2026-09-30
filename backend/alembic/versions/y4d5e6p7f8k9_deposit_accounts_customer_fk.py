"""권한체계 P0-2(문제 A): deposit_accounts.customer_id → clients.id FK 추가.

FK 가 없으면 고아 레코드가 권한 검사에서 조용히 빠진다.
고아 레코드가 하나라도 있으면 FK 를 걸지 않고 경고만 남긴다(데이터를 임의로 지우지 않음).
서버 시작 시 `alembic upgrade head` 가 자동 실행되므로, 여기서 멈추면 서버가 뜨지 않기 때문이다.
경고가 나오면 backend/scripts/permission_precheck.sql 4번으로 확인·정리한 뒤
`python scripts/add_deposit_fk.py` 로 FK 를 추가한다. (권한 판정은 FK 없이도 서브쿼리로 동작)

profile_id 는 빈 문자열("")로 저장되는 경우가 있어 FK 를 걸지 않는다.

Revision ID: y4d5e6p7f8k9
Revises: x3t4r5a6n7s8
Create Date: 2026-09-30 13:03:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = "y4d5e6p7f8k9"
down_revision = "x3t4r5a6n7s8"
branch_labels = None
depends_on = None

FK_NAME = "fk_deposit_accounts_customer_id_clients"


def upgrade() -> None:
    conn = op.get_bind()
    orphans = conn.execute(
        sa.text(
            "SELECT COUNT(*) FROM deposit_accounts d "
            "LEFT JOIN clients c ON c.id = d.customer_id WHERE c.id IS NULL"
        )
    ).scalar()
    if orphans:
        print(
            f"[경고] deposit_accounts 에 고객(clients)과 연결되지 않은 행이 {orphans}건 있어 FK 추가를 건너뜁니다. "
            "scripts/permission_precheck.sql 4번으로 확인·정리 후 python scripts/add_deposit_fk.py 를 실행하세요."
        )
        return
    op.create_foreign_key(
        FK_NAME, "deposit_accounts", "clients", ["customer_id"], ["id"], ondelete="CASCADE"
    )


def downgrade() -> None:
    # FK 를 건너뛴 경우도 있으므로 있을 때만 제거
    op.execute(f"ALTER TABLE deposit_accounts DROP CONSTRAINT IF EXISTS {FK_NAME}")
