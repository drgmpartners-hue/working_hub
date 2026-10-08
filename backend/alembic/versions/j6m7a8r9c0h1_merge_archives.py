"""merge_archives — 중복 고객 합치기 때 정리한 은퇴설계 등의 보관본 (2026-10-08).

Revision ID: j6m7a8r9c0h1
Revises: i5p6t7a8l9t0
"""
from alembic import op
import sqlalchemy as sa

revision = "j6m7a8r9c0h1"
down_revision = "i5p6t7a8l9t0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "merge_archives",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("kind", sa.String(40), nullable=False),
        sa.Column("client_id", sa.String(36), nullable=True),
        sa.Column("removed_client_id", sa.String(36), nullable=True),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("created_by", sa.String(36), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_merge_archives_client_id", "merge_archives", ["client_id"])


def downgrade() -> None:
    op.drop_index("ix_merge_archives_client_id", table_name="merge_archives")
    op.drop_table("merge_archives")
