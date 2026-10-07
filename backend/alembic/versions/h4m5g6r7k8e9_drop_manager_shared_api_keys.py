"""매니저 계정에 남은 회사 공용 서비스 키 삭제 (2026-10-07 결정).

회사 공용 키(Notion 외 전부)는 이제 대표(role=owner)가 등록한 것만 쓴다(services/collectors/key_access.py).
매니저가 예전에 넣어 둔 공용 서비스 키(Claude·Gemini·KIS·DART·네이버·공공데이터·KIPRIS 등)는 어디에도 쓰이지 않고,
매니저 화면에서 고치거나 지울 수도 없으므로 지운다. 매니저 본인의 Notion 키와 대표 계정의 키는 그대로 둔다.
되돌릴 수 없으므로 downgrade 는 아무것도 하지 않는다.

Revision ID: h4m5g6r7k8e9
Revises: g3k4i5w6o7m8
"""
from alembic import op

revision = "h4m5g6r7k8e9"
down_revision = "g3k4i5w6o7m8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        DELETE FROM user_api_keys k
        USING users u
        WHERE k.user_id = u.id
          AND u.role <> 'owner'
          AND k.provider <> 'notion'
        """
    )


def downgrade() -> None:
    pass
