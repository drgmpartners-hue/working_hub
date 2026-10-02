"""고객 포털 본인 확인 잠금을 DB 로 (수정_tasks P1-20).

예전에는 서버 메모리(defaultdict)에 실패 횟수를 두어
  - 없는 링크로 요청해도 항목이 계속 쌓이고(메모리 DoS),
  - 서버(워커)가 여러 개거나 재시작하면 잠금이 풀렸다.
이제 고객 행에 실패 횟수·잠금 해제 시각을 둔다(있는 고객만 기록).

함께: 고유번호(unique_code)가 비어 있는 예전 고객에게 6자리 번호를 채운다.
포털 본인 확인이 고유번호를 필수로 확인하게 바뀌어(수정_tasks P2-9), 비어 있으면 포털에 못 들어오기 때문.

Revision ID: f2p3o4r5t6l7
Revises: e1r2p3t4h5y6
"""
import secrets

from alembic import op
import sqlalchemy as sa

revision = "f2p3o4r5t6l7"
down_revision = "e1r2p3t4h5y6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("clients", sa.Column("portal_failures", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("clients", sa.Column("portal_locked_until", sa.DateTime(), nullable=True))

    conn = op.get_bind()
    used = {r[0] for r in conn.execute(sa.text("SELECT unique_code FROM clients WHERE unique_code IS NOT NULL"))}
    missing = [r[0] for r in conn.execute(sa.text(
        "SELECT id FROM clients WHERE unique_code IS NULL OR TRIM(unique_code) = ''"))]
    for cid in missing:
        code = f"{secrets.randbelow(900000) + 100000}"
        while code in used:
            code = f"{secrets.randbelow(900000) + 100000}"
        used.add(code)
        conn.execute(sa.text("UPDATE clients SET unique_code = :c WHERE id = :i"), {"c": code, "i": cid})


def downgrade() -> None:
    op.drop_column("clients", "portal_locked_until")
    op.drop_column("clients", "portal_failures")
