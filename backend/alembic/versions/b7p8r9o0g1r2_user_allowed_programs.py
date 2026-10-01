"""매니저별 사용 프로그램 (docs/login_logic P11).

users.allowed_programs (JSONB): NULL = 전부 허용. 기존 계정은 모두 NULL 로 두어 지금처럼 전부 쓴다.
새 매니저는 대표가 관리 화면에서 고른 프로그램만 쓴다.

Revision ID: b7p8r9o0g1r2
Revises: a6m7g8r9c0o1
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "b7p8r9o0g1r2"
down_revision = "a6m7g8r9c0o1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("allowed_programs", JSONB, nullable=True))


def downgrade() -> None:
    op.drop_column("users", "allowed_programs")
