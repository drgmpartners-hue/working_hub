"""키움증권 API 키 삭제 (2026-10-07 결정).

키움증권 키 입력 화면은 이미 빠졌고 키움 키를 읽는 코드도 없다. 남아 있던 키 행만 지운다.
되돌릴 수 없으므로 downgrade 는 아무것도 하지 않는다(필요하면 화면에서 다시 등록하는 구조가 아님 — 기능 자체가 없음).

Revision ID: g3k4i5w6o7m8
Revises: f2p3o4r5t6l7
"""
from alembic import op

revision = "g3k4i5w6o7m8"
down_revision = "f2p3o4r5t6l7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DELETE FROM user_api_keys WHERE provider = 'kiwoom'")


def downgrade() -> None:
    pass
