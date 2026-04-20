"""add new fields to desired_plans table.

Revision ID: u7v8w9x0y1z2
Revises: t6u7v8w9x0y1
Create Date: 2026-04-13 00:00:00.000000

추가 필드:
- pension_period_years: 연금수령기간 (년)
- current_value_monthly: 현재가치 수령액 (원)
- future_monthly_amount: 은퇴당시 수령액 (원)
- inflation_rate: 물가상승률
- retirement_pension_rate: 은퇴연금 수익률
- desired_retirement_age: 희망 은퇴나이
- savings_period_years: 적립기간 (년)
- holding_period_years: 거치기간 (년)
- expected_return_rate: 예상수익률
- annual_savings_amount: 연적립 금액 (원)
- target_retirement_fund: 목표 은퇴자금 (원)
- required_lump_sum_new: 필요 거치금액 (원)
- use_inflation_input: 물가반영 토글1
- use_inflation_calc: 물가반영 토글2
- simulation_monthly_savings: 시뮬레이션 월적립금액
- simulation_annual_lump_sum: 시뮬레이션 연 거치금액
- simulation_total_lump_sum: 시뮬레이션 총 거치금액
- simulation_target_fund: 시뮬레이션 목표 은퇴자금
- simulation_data: 연차별 시뮬레이션 데이터 (JSONB)
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "u7v8w9x0y1z2"
down_revision = "t6u7v8w9x0y1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 입력값 필드
    op.add_column("desired_plans", sa.Column("pension_period_years", sa.Integer(), nullable=True))
    op.add_column("desired_plans", sa.Column("current_value_monthly", sa.BigInteger(), nullable=True))
    op.add_column("desired_plans", sa.Column("future_monthly_amount", sa.BigInteger(), nullable=True))
    op.add_column("desired_plans", sa.Column("inflation_rate", sa.Float(), nullable=True))
    op.add_column("desired_plans", sa.Column("retirement_pension_rate", sa.Float(), nullable=True))
    op.add_column("desired_plans", sa.Column("desired_retirement_age", sa.Integer(), nullable=True))
    op.add_column("desired_plans", sa.Column("savings_period_years", sa.Integer(), nullable=True))
    op.add_column("desired_plans", sa.Column("holding_period_years", sa.Integer(), nullable=True))
    op.add_column("desired_plans", sa.Column("expected_return_rate", sa.Float(), nullable=True))
    op.add_column("desired_plans", sa.Column("annual_savings_amount", sa.BigInteger(), nullable=True))

    # 계산 결과 필드
    op.add_column("desired_plans", sa.Column("target_retirement_fund", sa.BigInteger(), nullable=True))
    op.add_column("desired_plans", sa.Column("required_lump_sum_new", sa.BigInteger(), nullable=True))

    # 토글 상태
    op.add_column("desired_plans", sa.Column("use_inflation_input", sa.Boolean(), nullable=True))
    op.add_column("desired_plans", sa.Column("use_inflation_calc", sa.Boolean(), nullable=True))

    # 시뮬레이션 필드
    op.add_column("desired_plans", sa.Column("simulation_monthly_savings", sa.BigInteger(), nullable=True))
    op.add_column("desired_plans", sa.Column("simulation_annual_lump_sum", sa.BigInteger(), nullable=True))
    op.add_column("desired_plans", sa.Column("simulation_total_lump_sum", sa.BigInteger(), nullable=True))
    op.add_column("desired_plans", sa.Column("simulation_target_fund", sa.BigInteger(), nullable=True))
    op.add_column("desired_plans", sa.Column("simulation_data", postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("desired_plans", "simulation_data")
    op.drop_column("desired_plans", "simulation_target_fund")
    op.drop_column("desired_plans", "simulation_total_lump_sum")
    op.drop_column("desired_plans", "simulation_annual_lump_sum")
    op.drop_column("desired_plans", "simulation_monthly_savings")
    op.drop_column("desired_plans", "use_inflation_calc")
    op.drop_column("desired_plans", "use_inflation_input")
    op.drop_column("desired_plans", "required_lump_sum_new")
    op.drop_column("desired_plans", "target_retirement_fund")
    op.drop_column("desired_plans", "annual_savings_amount")
    op.drop_column("desired_plans", "expected_return_rate")
    op.drop_column("desired_plans", "holding_period_years")
    op.drop_column("desired_plans", "savings_period_years")
    op.drop_column("desired_plans", "desired_retirement_age")
    op.drop_column("desired_plans", "retirement_pension_rate")
    op.drop_column("desired_plans", "inflation_rate")
    op.drop_column("desired_plans", "future_monthly_amount")
    op.drop_column("desired_plans", "current_value_monthly")
    op.drop_column("desired_plans", "pension_period_years")
