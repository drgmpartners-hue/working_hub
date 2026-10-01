"""기업 리포트: 기업을 '추가한 계정' 목록 (company_members).

2026-10-01 대표 결정
- 매니저는 빈 목록에서 시작해 직접 기업을 추가한다(대표 기업을 물려받지 않음).
- 같은 기업을 여러 매니저가 추가해도 기업·기사는 하나(수집은 한 번), 추가한 계정만 늘어난다.
- 대표 화면에는 모든 기업이 모이고, 누가 추가했는지 보인다.

기존 데이터
- 매니저가 추가한 기업(manager_user_id 있음) → 그 매니저
- 회사 공통 기업(manager_user_id 없음)       → 대표 계정(들)
- company_hidden(숨기기)은 더 쓰지 않는다(테이블은 남김).

Revision ID: c8m9e0m1b2r3
Revises: b7p8r9o0g1r2
"""
from alembic import op
import sqlalchemy as sa

revision = "c8m9e0m1b2r3"
down_revision = "b7p8r9o0g1r2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "company_members",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("company_id", sa.String(36), sa.ForeignKey("portfolio_companies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("company_id", "user_id", name="uq_company_member"),
    )
    op.create_index("ix_company_members_user_id", "company_members", ["user_id"])
    op.create_index("ix_company_members_company_id", "company_members", ["company_id"])
    op.execute("""
        INSERT INTO company_members (id, company_id, user_id, created_at)
        SELECT md5(random()::text || c.id)::uuid::text, c.id, c.manager_user_id, c.created_at
        FROM portfolio_companies c
        JOIN users u ON u.id = c.manager_user_id
        WHERE c.manager_user_id IS NOT NULL
    """)
    op.execute("""
        INSERT INTO company_members (id, company_id, user_id, created_at)
        SELECT md5(random()::text || c.id || u.id)::uuid::text, c.id, u.id, c.created_at
        FROM portfolio_companies c
        CROSS JOIN users u
        WHERE c.manager_user_id IS NULL AND u.role = 'owner'
    """)


def downgrade() -> None:
    op.drop_index("ix_company_members_company_id", table_name="company_members")
    op.drop_index("ix_company_members_user_id", table_name="company_members")
    op.drop_table("company_members")
