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


def _to_float(value: Any, default: float = 0.0) -> float:
    """엑셀 유래 값(None, '3,000,000', ' 6.0 ' 등)을 안전하게 float으로."""
    if value is None:
        return default
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(str(value).replace(",", "").strip() or default)
    except (ValueError, TypeError):
        return default


def _norm_rate(value: Any, default: float) -> float:
    """수수료율 정규화: 6.0(%) 표기와 0.06 표기를 모두 허용."""
    rate = _to_float(value, default)
    return rate / 100 if rate >= 1 else rate


def _compute_dr_gm(employee: dict[str, Any]) -> dict[str, Any]:
    """Compute Dr.GM commission for a single employee entry."""
    base_salary = _to_float(employee.get("base_salary"))
    rate = _norm_rate(employee.get("commission_rate"), _DEFAULT_RATE["dr_gm"])
    commission = round(base_salary * rate, 2)
    return {
        **employee,
        "commission_amount": commission,
        "commission_rate_used": rate,
        "calc_basis": "base_salary",
    }


def _compute_securities(employee: dict[str, Any]) -> dict[str, Any]:
    """Compute securities commission for a single employee entry."""
    sales_amount = _to_float(employee.get("sales_amount"))
    rate = _norm_rate(employee.get("commission_rate"), _DEFAULT_RATE["securities"])
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


# 엑셀/크롤링 행 → employee 필드 매핑 (한국어 헤더 허용)
_EMP_KEY_MAP = {
    "name": ["name", "이름", "성명", "직원명", "사원명"],
    "employee_id": ["employee_id", "사번", "id"],
    "base_salary": ["base_salary", "기본급", "기본급여", "급여"],
    "sales_amount": ["sales_amount", "매출액", "판매금액", "매출", "판매액"],
    "commission_rate": ["commission_rate", "수수료율", "수당율", "요율", "수당률"],
}


def _map_row_to_employee(row: dict[str, Any]) -> dict[str, Any]:
    """파싱된 행(dict)을 계산기가 이해하는 employee dict로 변환."""
    lowered = {str(k).strip().lower(): v for k, v in row.items() if k is not None}
    emp: dict[str, Any] = dict(row)  # 원본 필드도 detail로 보존
    for target, aliases in _EMP_KEY_MAP.items():
        for alias in aliases:
            if alias in lowered and lowered[alias] is not None:
                emp[target] = lowered[alias]
                break
    return emp


async def _derive_employees(
    db: AsyncSession, data: CommissionCalculationCreate
) -> list[dict[str, Any]]:
    """input_data.employees가 없을 때 엑셀 업로드/크롤링 결과에서 자동 도출."""
    rows: list[dict[str, Any]] = []

    if data.source_file_path:
        from app.models.file_upload import FileUpload  # noqa: PLC0415
        res = await db.execute(
            select(FileUpload)
            .where(FileUpload.file_path == data.source_file_path)
            .order_by(FileUpload.uploaded_at.desc())
            .limit(1)
        )
        upload = res.scalars().first()
        parsed = (upload.parsed_data or {}) if upload else {}
        for sheet_rows in (parsed.get("data") or {}).values():
            if isinstance(sheet_rows, list):
                rows.extend(r for r in sheet_rows if isinstance(r, dict))

    crawling_job_id = data.input_data.get("crawling_job_id")
    if not rows and crawling_job_id:
        from app.models.crawling import CrawlingJob  # noqa: PLC0415
        job = await db.get(CrawlingJob, crawling_job_id)
        result_data = (job.result_data or {}) if job else {}
        raw = result_data.get("rows") or result_data.get("data") or []
        if isinstance(raw, dict):
            for v in raw.values():
                if isinstance(v, list):
                    rows.extend(r for r in v if isinstance(r, dict))
        elif isinstance(raw, list):
            rows.extend(r for r in raw if isinstance(r, dict))

    return [_map_row_to_employee(r) for r in rows]


async def create_calculation(
    db: AsyncSession,
    user_id: str,
    data: CommissionCalculationCreate,
) -> CommissionCalculation:
    """Run commission calculation, persist records and return the calculation."""
    # 0. employees 확보: 프런트가 직접 주지 않으면 업로드/크롤링 결과에서 도출.
    #    (기존엔 input_data.employees가 없으면 결과 0건으로 조용히 '완료'되던 문제)
    input_data = dict(data.input_data)
    if not input_data.get("employees"):
        input_data["employees"] = await _derive_employees(db, data)
    if not input_data["employees"]:
        raise ValueError(
            "계산할 직원 데이터를 찾지 못했습니다. "
            "엑셀 업로드 또는 크롤링 데이터를 먼저 확인해주세요."
        )
    data = data.model_copy(update={"input_data": input_data})

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
