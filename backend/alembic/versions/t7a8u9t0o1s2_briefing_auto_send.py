"""기업 리포트: 승인 기간 없애고 자동 발송 — 저장된 승인 종료일 지우기(2026-09-29).

Revision ID: t7a8u9t0o1s2
Revises: s6h7o8r9t0l1
Create Date: 2026-09-29 20:00:00.000000
"""
from alembic import op

revision = "t7a8u9t0o1s2"
down_revision = "s6h7o8r9t0l1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DELETE FROM app_settings WHERE key = 'news_briefing_review_until'")


def downgrade() -> None:
    pass  # 지운 승인 종료일은 되돌리지 않는다(필요하면 발송 설정의 [승인 기간 다시 시작])
