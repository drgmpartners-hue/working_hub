"""권한체계: users.role / created_by_user_id / deactivated_at (docs/login_logic P1-2).

순서가 중요하다(지시서 12.2).
  (1) role 을 server_default='owner' 로 추가 → 기존 계정은 전부 대표로 백필
  (2) 그 다음 기본값을 'manager' 로 교체 → 이후 신규 가입자는 매니저
검증: SELECT role, COUNT(*) FROM users GROUP BY role → owner = 기존 계정 수, manager = 0

Revision ID: v1r2o3l4e5a6
Revises: u8r9e0c1n2m3
Create Date: 2026-09-30 13:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = "v1r2o3l4e5a6"
down_revision = "u8r9e0c1n2m3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # (1) 기존 행은 전부 대표
    op.add_column(
        "users",
        sa.Column("role", sa.String(20), nullable=False, server_default="owner"),
    )
    # (2) 신규 가입자는 매니저
    op.alter_column("users", "role", server_default="manager")
    # (3) 인덱스
    op.create_index("ix_users_role", "users", ["role"])

    op.add_column(
        "users",
        sa.Column(
            "created_by_user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL", name="fk_users_created_by_user_id"),
            nullable=True,
        ),
    )
    op.add_column("users", sa.Column("deactivated_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "deactivated_at")
    op.drop_constraint("fk_users_created_by_user_id", "users", type_="foreignkey")
    op.drop_column("users", "created_by_user_id")
    op.drop_index("ix_users_role", table_name="users")
    op.drop_column("users", "role")
