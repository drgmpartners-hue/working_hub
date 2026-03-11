"""Commission calculation service.

Handles business logic for:
- Creating commission calculations and persisting results per employee.
- Retrieving calculations and results for a given user.

Calculation logic
-----------------
input_data is expected to contain an "employees" list where each entry has at
minimum:

    {
        "name":            "홍길동",
        "base_salary":     3000000,
        "sales_amount":    15000000,   # optional
        "commission_rate": 0.05,       # optional (fraction, e.g. 5 % == 0.05)
        ...                            # arbitrary extra fields stored as-is
    }

For "dr_gm" calc_type the commission is computed as:
    commission = base_salary * commission_rate  (defaults: rate 0.03)

For "securities" calc_type the commission is computed as:
    commission = sales_amount * commission_rate  (defaults: rate 0.05)

Both formulas add the result to a ``commission_amount`` field in the per-
employee result stored in CommissionResult.detail_data.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.commission import CommissionCalculation, CommissionResult
from app.schemas.commission import CommissionCalculationCreate


# ---------------------------------------------------------------------------
# Internal calculation helpers
# ---------------------------------------------------------------------------

_DEFAULT_RATE: dict[str, float] = {
    "dr_gm": 0.03,
    "securities": 0.05,
}


def _compute_dr_gm(employee: dict[str, Any]) -> dict[str, Any]:
    """Compute Dr.GM commission for a single employee entry."""
    base_salary = float(employee.get("base_salary", 0))
    rate = float(employee.get("commission_rate", _DEFAULT_RATE["dr_gm"]))
    commission = round(base_salary * rate, 2)
    return {
        **employee,
        "commission_amount": commission,
        "commission_rate_used": rate,
        "calc_basis": "base_salary",
    }


def _compute_securities(employee: dict[str, Any]) -> dict[str, Any]:
    """Compute securities commission for a single employee entry."""
    sales_amount = float(employee.get("sales_amount", 0))
    rate = float(employee.get("commission_rate", _DEFAULT_RATE["securities"]))
    commission = round(sales_amount * rate, 2)
    return {
        **employee,
        "commission_amount": commission,
        "commission_rate_used": rate,
        "calc_basis": "sales_amount",
    }


_CALCULATORS = {
    "dr_gm": _compute_dr_gm,
    "securities": _compute_securities,
}


def _run_calculation(
    calc_type: str, input_data: dict[str, Any]
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Apply commission formulas and return (per-employee results, summary).

    Returns a list of per-employee detail dicts and a top-level result_data
    summary dict stored on the CommissionCalculation record.
    """
    calculator = _CALCULATORS.get(calc_type)
    if calculator is None:
        raise ValueError(f"Unknown calc_type: {calc_type!r}")

    employees: list[dict[str, Any]] = input_data.get("employees", [])
    if not isinstance(employees, list):
        employees = []

    per_employee: list[dict[str, Any]] = [
        calculator(emp) for emp in employees
    ]

    total_commission = sum(
        e.get("commission_amount", 0) for e in per_employee
    )
    result_data: dict[str, Any] = {
        "total_employees": len(per_employee),
        "total_commission": round(total_commission, 2),
        "calc_type": calc_type,
    }
    return per_employee, result_data


# ---------------------------------------------------------------------------
# Public service functions
# ---------------------------------------------------------------------------


async def create_calculation(
    db: AsyncSession,
    user_id: str,
    data: CommissionCalculationCreate,
) -> CommissionCalculation:
    """Run commission calculation, persist records and return the calculation."""
    # 1. Run business logic (CPU-bound but light enough for async context)
    per_employee, result_data = _run_calculation(data.calc_type, data.input_data)

    # 2. Persist the parent CommissionCalculation
    calculation = CommissionCalculation(
        user_id=user_id,
        calc_type=data.calc_type,
        source_file_path=data.source_file_path,
        input_data=data.input_data,
        result_data=result_data,
        status="completed",
    )
    db.add(calculation)
    await db.flush()  # get calculation.id before inserting children

    # 3. Persist per-employee CommissionResult rows
    for emp_detail in per_employee:
        employee_name = str(emp_detail.get("name", "unknown"))
        result_row = CommissionResult(
            calculation_id=calculation.id,
            employee_name=employee_name,
            detail_data=emp_detail,
            report_file_path=None,
        )
        db.add(result_row)

    await db.commit()
    await db.refresh(calculation)
    return calculation


async def get_calculations(
    db: AsyncSession,
    user_id: str,
) -> list[CommissionCalculation]:
    """Return all calculations owned by *user_id* ordered newest first."""
    stmt = (
        select(CommissionCalculation)
        .where(CommissionCalculation.user_id == user_id)
        .order_by(CommissionCalculation.created_at.desc())
    )
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def get_calculation(
    db: AsyncSession,
    user_id: str,
    calc_id: str,
) -> CommissionCalculation | None:
    """Return a single calculation if it belongs to *user_id*."""
    stmt = select(CommissionCalculation).where(
        CommissionCalculation.id == calc_id,
        CommissionCalculation.user_id == user_id,
    )
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def get_results(
    db: AsyncSession,
    calc_id: str,
) -> list[CommissionResult]:
    """Return all CommissionResult rows for a given calculation."""
    stmt = (
        select(CommissionResult)
        .where(CommissionResult.calculation_id == calc_id)
        .order_by(CommissionResult.employee_name)
    )
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def get_result(
    db: AsyncSession,
    result_id: str,
) -> CommissionResult | None:
    """Return a single CommissionResult by primary key."""
    stmt = select(CommissionResult).where(CommissionResult.id == result_id)
    result = await db.execute(stmt)
    return result.scalar_one_or_none()
