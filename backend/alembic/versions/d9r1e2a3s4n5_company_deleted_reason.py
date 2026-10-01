"""기업 리포트: 화면에서 삭제된 이유 (portfolio_companies.deleted_reason).

- 'all_removed' : 추가했던 담당자가 모두 목록에서 뺌(마지막 사람 = deleted_by)
- 'admin'       : 대표·관리자가 [삭제]
- NULL          : 예전에 삭제된 기업(이유 기록 전)
폴더까지 완전 삭제는 대표가 [삭제된 기업]에서 따로 한다.

Revision ID: d9r1e2a3s4n5
Revises: c8m9e0m1b2r3
"""
from alembic import op
import sqlalchemy as sa

revision = "d9r1e2a3s4n5"
down_revision = "c8m9e0m1b2r3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("portfolio_companies", sa.Column("deleted_reason", sa.String(20), nullable=True))


def downgrade() -> None:
    op.drop_column("portfolio_companies", "deleted_reason")
