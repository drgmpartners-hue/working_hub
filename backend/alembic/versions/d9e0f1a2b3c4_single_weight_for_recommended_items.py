"""single weight column for recommended portfolio items

계좌 종류(연금저축/IRP) 구분이 탭으로 대체되면서 비중을 하나로 합친다.
기존 값은 탭의 account_type을 보고 알맞은 쪽을 골라 weight로 옮긴다.
weight_pension / weight_irp 컬럼은 되돌릴 수 있도록 남겨 둔다.

Revision ID: d9e0f1a2b3c4
Revises: c8d9e0f1a2b3
Create Date: 2026-08-13
"""
from alembic import op
import sqlalchemy as sa

revision = "d9e0f1a2b3c4"
down_revision = "c8d9e0f1a2b3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "recommended_portfolio_items",
        sa.Column("weight", sa.Float(), nullable=True),
    )

    conn = op.get_bind()

    # 탭이 IRP용이었으면 weight_irp를, 아니면 weight_pension을 우선한다.
    # 우선 값이 비어 있으면 반대쪽 값이라도 살린다 (한쪽만 채워 둔 경우가 많다).
    conn.execute(
        sa.text(
            """
            UPDATE recommended_portfolio_items AS i
               SET weight = CASE
                     WHEN p.account_type = 'irp'
                       THEN COALESCE(i.weight_irp, i.weight_pension)
                     ELSE COALESCE(i.weight_pension, i.weight_irp)
                   END
              FROM recommended_portfolios AS p
             WHERE i.portfolio_id = p.id
            """
        )
    )
    # 탭에 붙지 않은 잔여 항목
    conn.execute(
        sa.text(
            """
            UPDATE recommended_portfolio_items
               SET weight = COALESCE(weight_pension, weight_irp)
             WHERE portfolio_id IS NULL
            """
        )
    )


def downgrade() -> None:
    op.drop_column("recommended_portfolio_items", "weight")
