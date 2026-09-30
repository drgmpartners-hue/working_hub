"""권한체계: audit_logs 테이블 + 인덱스 3종 (docs/login_logic P1-3).

Revision ID: w2a3u4d5i6t7
Revises: v1r2o3l4e5a6
Create Date: 2026-09-30 13:01:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = "w2a3u4d5i6t7"
down_revision = "v1r2o3l4e5a6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "audit_logs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("actor_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("effective_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("is_impersonated", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("action", sa.String(50), nullable=False),
        sa.Column("resource_type", sa.String(50), nullable=True),
        sa.Column("resource_id", sa.String(64), nullable=True),
        sa.Column("client_id", sa.String(36), nullable=True),
        sa.Column("method", sa.String(10), nullable=True),
        sa.Column("path", sa.String(300), nullable=True),
        sa.Column("status_code", sa.Integer(), nullable=True),
        sa.Column("payload_summary", sa.JSON(), nullable=True),
        sa.Column("ip", sa.String(45), nullable=True),
        sa.Column("user_agent", sa.String(300), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_audit_logs_client_created", "audit_logs", ["client_id", sa.text("created_at DESC")])
    op.create_index("ix_audit_logs_actor_created", "audit_logs", ["actor_user_id", sa.text("created_at DESC")])
    op.create_index("ix_audit_logs_created", "audit_logs", [sa.text("created_at DESC")])


def downgrade() -> None:
    op.drop_index("ix_audit_logs_created", table_name="audit_logs")
    op.drop_index("ix_audit_logs_actor_created", table_name="audit_logs")
    op.drop_index("ix_audit_logs_client_created", table_name="audit_logs")
    op.drop_table("audit_logs")
