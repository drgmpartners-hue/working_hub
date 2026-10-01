"""기업 리포트 담당자별 분리 (docs/login_logic P9).

- portfolio_companies.manager_user_id : NULL = 회사 공통(대표 등록), 값 = 그 매니저가 추가한 기업
- company_hidden                      : 매니저가 회사 공통 기업을 자기 화면에서 숨김
- briefing_recipients.manager_user_id : 수신자 명단 주인. NULL = 회사(대표) 명단, 값 = 그 매니저 명단
  같은 사람이 여러 명단에 들어갈 수 있도록 유니크를 (명단 주인, 사람) 단위로 바꾼다.

기존 데이터는 모두 회사 공통·대표 명단(NULL)으로 남으므로 따로 옮길 것이 없다.

Revision ID: a6m7g8r9c0o1
Revises: z5o6w7n8e9r0
"""
from alembic import op
import sqlalchemy as sa

revision = "a6m7g8r9c0o1"
down_revision = "z5o6w7n8e9r0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "portfolio_companies",
        sa.Column("manager_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
    )
    op.create_index("ix_portfolio_companies_manager_user_id", "portfolio_companies", ["manager_user_id"])

    op.create_table(
        "company_hidden",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("company_id", sa.String(36), sa.ForeignKey("portfolio_companies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("user_id", "company_id", name="uq_company_hidden_user_company"),
    )
    op.create_index("ix_company_hidden_user_id", "company_hidden", ["user_id"])

    op.add_column(
        "briefing_recipients",
        sa.Column("manager_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=True),
    )
    op.create_index("ix_briefing_recipients_manager_user_id", "briefing_recipients", ["manager_user_id"])
    op.execute("ALTER TABLE briefing_recipients DROP CONSTRAINT IF EXISTS briefing_recipients_user_id_key")
    op.execute("ALTER TABLE briefing_recipients DROP CONSTRAINT IF EXISTS uq_briefing_recipients_client")
    op.execute(
        "CREATE UNIQUE INDEX uq_briefing_recipients_list_user ON briefing_recipients "
        "(COALESCE(manager_user_id, ''), user_id) WHERE user_id IS NOT NULL"
    )
    op.execute(
        "CREATE UNIQUE INDEX uq_briefing_recipients_list_client ON briefing_recipients "
        "(COALESCE(manager_user_id, ''), client_id) WHERE client_id IS NOT NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_briefing_recipients_list_client")
    op.execute("DROP INDEX IF EXISTS uq_briefing_recipients_list_user")
    # 매니저 명단은 되돌릴 자리가 없으므로 지운다(회사 명단만 남김)
    op.execute("DELETE FROM briefing_recipients WHERE manager_user_id IS NOT NULL")
    op.create_unique_constraint("briefing_recipients_user_id_key", "briefing_recipients", ["user_id"])
    op.create_unique_constraint("uq_briefing_recipients_client", "briefing_recipients", ["client_id"])
    op.drop_index("ix_briefing_recipients_manager_user_id", table_name="briefing_recipients")
    op.drop_column("briefing_recipients", "manager_user_id")
    op.drop_index("ix_company_hidden_user_id", table_name="company_hidden")
    op.drop_table("company_hidden")
    op.drop_index("ix_portfolio_companies_manager_user_id", table_name="portfolio_companies")
    op.drop_column("portfolio_companies", "manager_user_id")
