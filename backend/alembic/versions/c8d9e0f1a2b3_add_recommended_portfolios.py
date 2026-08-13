"""add recommended_portfolios (tabs) and link items

Dr.GM 추천 포트폴리오를 탭 단위로 여러 개 저장할 수 있도록
recommended_portfolios 테이블을 만들고, 기존 항목을 기본 탭으로 이관한다.

Revision ID: c8d9e0f1a2b3
Revises: b7c8d9e0f1a2
Create Date: 2026-08-13
"""
import uuid

from alembic import op
import sqlalchemy as sa

revision = "c8d9e0f1a2b3"
down_revision = "b7c8d9e0f1a2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "recommended_portfolios",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("account_type", sa.String(length=20), nullable=True),
        sa.Column("monthly_amount", sa.Float(), nullable=True),
        sa.Column("lump_sum_amount", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )

    op.add_column(
        "recommended_portfolio_items",
        sa.Column("portfolio_id", sa.String(length=36), nullable=True),
    )
    op.create_index(
        "ix_recommended_portfolio_items_portfolio_id",
        "recommended_portfolio_items",
        ["portfolio_id"],
    )
    op.create_foreign_key(
        "fk_recommended_portfolio_items_portfolio_id",
        "recommended_portfolio_items",
        "recommended_portfolios",
        ["portfolio_id"],
        ["id"],
        ondelete="CASCADE",
    )

    # 기존 항목이 있으면 기본 탭 하나를 만들어 전부 옮긴다 (데이터 유실 방지)
    conn = op.get_bind()
    existing = conn.execute(
        sa.text("SELECT COUNT(*) FROM recommended_portfolio_items")
    ).scalar()
    if existing:
        default_id = str(uuid.uuid4())
        conn.execute(
            sa.text(
                "INSERT INTO recommended_portfolios (id, name, seq, account_type, created_at, updated_at) "
                "VALUES (:id, :name, 0, 'pension', now(), now())"
            ),
            {"id": default_id, "name": "포트폴리오 1"},
        )
        conn.execute(
            sa.text(
                "UPDATE recommended_portfolio_items SET portfolio_id = :pid "
                "WHERE portfolio_id IS NULL"
            ),
            {"pid": default_id},
        )


def downgrade() -> None:
    op.drop_constraint(
        "fk_recommended_portfolio_items_portfolio_id",
        "recommended_portfolio_items",
        type_="foreignkey",
    )
    op.drop_index(
        "ix_recommended_portfolio_items_portfolio_id",
        table_name="recommended_portfolio_items",
    )
    op.drop_column("recommended_portfolio_items", "portfolio_id")
    op.drop_table("recommended_portfolios")
