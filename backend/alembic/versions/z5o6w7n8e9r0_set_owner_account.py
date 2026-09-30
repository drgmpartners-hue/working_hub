"""권한체계: 대표 계정 지정 (docs/login_logic 결정 D-6).

y4d5e6p7f8k9 까지는 '기존 계정 = 전부 대표'로 백필했다. 여기서 실제 대표 계정만 owner 로 남기고
나머지 기존 계정은 manager 로 내린다.

- 대표 이메일: 환경변수 OWNER_EMAIL (없으면 drgmpartners@gmail.com)
- 안전장치: 그 이메일의 활성 계정이 DB 에 없으면 아무것도 바꾸지 않는다(대표가 한 명도 없는 상태 방지)
- 서버 시작 시 alembic upgrade head 로 자동 실행된다

Revision ID: z5o6w7n8e9r0
Revises: y4d5e6p7f8k9
Create Date: 2026-09-30 16:10:00.000000
"""
import os

from alembic import op
import sqlalchemy as sa

revision = "z5o6w7n8e9r0"
down_revision = "y4d5e6p7f8k9"
branch_labels = None
depends_on = None

DEFAULT_OWNER_EMAIL = "drgmpartners@gmail.com"


def upgrade() -> None:
    email = (os.environ.get("OWNER_EMAIL") or DEFAULT_OWNER_EMAIL).strip().lower()
    conn = op.get_bind()
    owner_id = conn.execute(
        sa.text("SELECT id FROM users WHERE lower(email) = :e AND is_active = true"), {"e": email}
    ).scalar()
    if not owner_id:
        print(f"[경고] 대표 계정({email})을 찾지 못해 역할을 바꾸지 않았습니다. 기존 계정은 모두 대표로 남아 있습니다.")
        return
    conn.execute(sa.text("UPDATE users SET role = 'owner' WHERE id = :i"), {"i": owner_id})
    n = conn.execute(sa.text("UPDATE users SET role = 'manager' WHERE id <> :i AND role = 'owner'"), {"i": owner_id}).rowcount
    print(f"대표 계정: {email} · 매니저로 바뀐 기존 계정 {n}개")


def downgrade() -> None:
    # 이전 상태(기존 계정 전부 owner)로 되돌린다
    op.execute("UPDATE users SET role = 'owner'")
