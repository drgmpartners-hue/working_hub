"""Investment Records API - CRUD + annual flow for retirement planning."""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.core.deps import CurrentUser
from app.models.investment_record import InvestmentRecord
from app.models.customer_retirement_profile import CustomerRetirementProfile
from app.schemas.investment_record import (
    InvestmentRecordCreate,
    InvestmentRecordUpdate,
    InvestmentRecordResponse,
    AnnualFlowResponse,
)
from app.services.annual_flow_calc import calculate_return_rate, calculate_annual_flow

router = APIRouter(prefix="/retirement/investment-records", tags=["retirement"])


async def _get_profile_or_404(
    profile_id: str,
    db: AsyncSession,
) -> CustomerRetirementProfile:
    """프로필 존재 여부 확인 헬퍼. profile.id 또는 customer_id로 조회."""
    # 먼저 id로 조회
    result = await db.execute(
        select(CustomerRetirementProfile).where(
            CustomerRetirementProfile.id == profile_id
        )
    )
    profile = result.scalar_one_or_none()
    if not profile:
        # customer_id로 재시도
        result2 = await db.execute(
            select(CustomerRetirementProfile).where(
                CustomerRetirementProfile.customer_id == profile_id
            )
        )
        profile = result2.scalar_one_or_none()
    if not profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="은퇴 설계 프로필을 찾을 수 없습니다.",
        )
    return profile


async def _get_record_or_404(
    record_id: int,
    db: AsyncSession,
) -> InvestmentRecord:
    """투자기록 존재 여부 확인 헬퍼."""
    result = await db.execute(
        select(InvestmentRecord).where(InvestmentRecord.id == record_id)
    )
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="투자기록을 찾을 수 없습니다.",
        )
    return record


# ---------------------------------------------------------------------------
# GET /api/v1/retirement/investment-records/annual-flow/{customer_id}/{year}
# 반드시 CRUD 엔드포인트보다 먼저 등록해야 path 충돌 방지
# ---------------------------------------------------------------------------

@router.get(
    "/annual-flow/{customer_id}/{year}",
    response_model=AnnualFlowResponse,
    summary="연간 투자흐름표 조회",
)
async def get_annual_flow(
    customer_id: str,
    year: int,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """고객의 연간 투자흐름표를 반환합니다.

    해당 연도(start_date 기준)의 투자기록을 집계하여 반환합니다.
    """
    # 고객의 은퇴 프로필 조회
    profile_result = await db.execute(
        select(CustomerRetirementProfile).where(
            CustomerRetirementProfile.customer_id == customer_id
        )
    )
    profile = profile_result.scalar_one_or_none()

    if not profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="은퇴 설계 프로필을 찾을 수 없습니다.",
        )

    # 설계사가 고객 관리하므로 권한 체크 완화

    # 해당 프로필의 투자기록 전체 조회 (서비스에서 연도 필터링)
    records_result = await db.execute(
        select(InvestmentRecord).where(
            InvestmentRecord.profile_id == profile.id
        )
    )
    records = records_result.scalars().all()

    # dict로 변환하여 서비스에 전달
    records_dict = [
        {
            "record_type": r.record_type,
            "investment_amount": r.investment_amount,
            "evaluation_amount": r.evaluation_amount,
            "status": r.status,
            "start_date": r.start_date,
            "end_date": r.end_date,
        }
        for r in records
    ]

    flow = calculate_annual_flow(records=records_dict, year=year)
    return flow


# ---------------------------------------------------------------------------
# GET /api/v1/retirement/investment-records
# ---------------------------------------------------------------------------

@router.get(
    "",
    response_model=List[InvestmentRecordResponse],
    summary="투자기록 목록 조회",
)
async def list_investment_records(
    customer_id: Optional[str] = Query(None, description="고객 user ID"),
    year: Optional[int] = Query(None, description="조회 연도 (start_date 기준)"),
    status_filter: Optional[str] = Query(None, alias="status", description="상태 필터: ing/exit/deposit"),
    current_user: CurrentUser = None,
    db: AsyncSession = Depends(get_db),
):
    """투자기록 목록 조회. customer_id, year, status 필터 지원."""
    query = select(InvestmentRecord)

    if customer_id:
        # customer_id -> profile_id 변환
        profile_result = await db.execute(
            select(CustomerRetirementProfile).where(
                CustomerRetirementProfile.customer_id == customer_id
            )
        )
        profile = profile_result.scalar_one_or_none()
        if not profile:
            return []

        query = query.where(InvestmentRecord.profile_id == profile.id)
    elif not current_user.is_superuser:
        # customer_id 없이 조회하는 경우 본인 기록만
        profile_result = await db.execute(
            select(CustomerRetirementProfile).where(
                CustomerRetirementProfile.customer_id == current_user.id
            )
        )
        profile = profile_result.scalar_one_or_none()
        if not profile:
            return []
        query = query.where(InvestmentRecord.profile_id == profile.id)

    if year:
        from sqlalchemy import extract
        query = query.where(
            extract("year", InvestmentRecord.start_date) == year
        )

    if status_filter:
        query = query.where(InvestmentRecord.status == status_filter)

    result = await db.execute(query)
    return result.scalars().all()


# ---------------------------------------------------------------------------
# POST /api/v1/retirement/investment-records
# ---------------------------------------------------------------------------

@router.post(
    "",
    response_model=InvestmentRecordResponse,
    status_code=status.HTTP_201_CREATED,
    summary="투자기록 생성",
)
async def create_investment_record(
    data: InvestmentRecordCreate,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """투자기록 생성.

    exit 상태인 경우 수익률을 자동 계산합니다.
    """
    # 프로필 확인 (customer_id → profile.id 변환)
    profile = await _get_profile_or_404(data.profile_id, db)

    # 수익률 자동 계산
    return_rate = None
    if data.status == "exit":
        return_rate = calculate_return_rate(
            investment_amount=data.investment_amount,
            evaluation_amount=data.evaluation_amount,
        )

    record_data = data.model_dump()
    record_data["profile_id"] = profile.id  # 실제 profile PK로 교체
    record = InvestmentRecord(
        **record_data,
        return_rate=return_rate,
    )
    db.add(record)
    await db.flush()  # record.id 확보
    await db.refresh(record)

    # 예수금 계좌 연동: deposit_account_id가 있으면 거래내역 자동 생성
    if data.deposit_account_id:
        from app.models.deposit_transaction import DepositTransaction
        from app.api.v1.deposit_accounts import recalculate_balances

        # 상품명 조회
        product_label = data.product_name or ""
        if data.wrap_account_id:
            from app.models.wrap_account import WrapAccount
            wa_result = await db.execute(
                select(WrapAccount).where(WrapAccount.id == data.wrap_account_id)
            )
            wa = wa_result.scalar_one_or_none()
            if wa:
                product_label = wa.product_name

        # 투자 시: 출금 (예수금에서 돈 나감)
        txn = DepositTransaction(
            deposit_account_id=data.deposit_account_id,
            transaction_date=data.start_date,
            transaction_type="investment",
            related_product=product_label,
            investment_record_id=record.id,
            credit_amount=0,
            debit_amount=data.investment_amount,
            memo=f"투자기록 #{record.id} 자동생성",
        )
        db.add(txn)

        # 종결 시: 입금 (예수금으로 돈 들어옴)
        if data.status == "exit" and data.evaluation_amount:
            txn_exit = DepositTransaction(
                deposit_account_id=data.deposit_account_id,
                transaction_date=data.actual_maturity_date or data.end_date or data.start_date,
                transaction_type="termination",
                related_product=product_label,
                investment_record_id=record.id,
                credit_amount=data.evaluation_amount,
                debit_amount=0,
                memo=f"투자기록 #{record.id} 종결 자동생성",
            )
            db.add(txn_exit)

        await db.flush()
        await recalculate_balances(data.deposit_account_id, db)

    await db.commit()
    await db.refresh(record)
    return record


# ---------------------------------------------------------------------------
# PUT /api/v1/retirement/investment-records/{id}
# ---------------------------------------------------------------------------

@router.put(
    "/{record_id}",
    response_model=InvestmentRecordResponse,
    summary="투자기록 수정",
)
async def update_investment_record(
    record_id: int,
    data: InvestmentRecordUpdate,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """투자기록 수정.

    exit 상태로 변경되거나 evaluation_amount가 수정되면 수익률을 재계산합니다.
    """
    record = await _get_record_or_404(record_id, db)

    update_fields = data.model_dump(exclude_unset=True)
    for field, value in update_fields.items():
        setattr(record, field, value)

    from app.models.deposit_transaction import DepositTransaction
    from app.api.v1.deposit_accounts import recalculate_balances

    # 실제만기일 유무에 따라 종결/운용중 자동 전환
    if record.actual_maturity_date:
        # 실제만기일 있음 → 종결
        if record.status != "exit":
            record.status = "exit"
        if not record.end_date:
            record.end_date = record.actual_maturity_date
    else:
        # 실제만기일 삭제됨 → 운용중으로 복귀
        if record.status == "exit":
            record.status = "ing"
            record.end_date = None

        # 기존 종결 거래 삭제
        existing_term = await db.execute(
            select(DepositTransaction).where(
                DepositTransaction.investment_record_id == record.id,
                DepositTransaction.transaction_type == "termination",
            )
        )
        term_txns = existing_term.scalars().all()
        affected_accounts = set()
        for txn in term_txns:
            affected_accounts.add(txn.deposit_account_id)
            await db.delete(txn)
        if affected_accounts:
            await db.flush()
            for acct_id in affected_accounts:
                await recalculate_balances(acct_id, db)

    # 수익률 재계산
    final_status = record.status
    final_investment = record.investment_amount
    final_evaluation = record.evaluation_amount

    if final_status == "exit":
        record.return_rate = calculate_return_rate(
            investment_amount=final_investment,
            evaluation_amount=final_evaluation,
        )
    else:
        record.return_rate = None

    # 예수금 계좌 연동: 종결 시 입금 거래 자동 생성
    deposit_acct_id = record.deposit_account_id
    if deposit_acct_id and final_status == "exit" and final_evaluation:
        # 기존 종결 거래가 있는지 확인 (중복 방지)
        existing = await db.execute(
            select(DepositTransaction).where(
                DepositTransaction.investment_record_id == record.id,
                DepositTransaction.transaction_type == "termination",
            )
        )
        if not existing.scalar_one_or_none():
            product_label = record.product_name or ""
            if record.wrap_account_id:
                from app.models.wrap_account import WrapAccount
                wa_r = await db.execute(select(WrapAccount).where(WrapAccount.id == record.wrap_account_id))
                wa = wa_r.scalar_one_or_none()
                if wa:
                    product_label = wa.product_name

            txn = DepositTransaction(
                deposit_account_id=deposit_acct_id,
                transaction_date=record.actual_maturity_date or record.end_date or record.start_date,
                transaction_type="termination",
                related_product=product_label,
                investment_record_id=record.id,
                credit_amount=final_evaluation,
                debit_amount=0,
                memo=f"투자기록 #{record.id} 종결 자동생성",
            )
            db.add(txn)
            await db.flush()
            await recalculate_balances(deposit_acct_id, db)

    await db.commit()
    await db.refresh(record)
    return record


# ---------------------------------------------------------------------------
# DELETE /api/v1/retirement/investment-records/{id}
# ---------------------------------------------------------------------------

@router.delete(
    "/{record_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="투자기록 삭제",
)
async def delete_investment_record(
    record_id: int,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """투자기록 삭제. 연결된 예수금 거래내역도 함께 삭제."""
    record = await _get_record_or_404(record_id, db)

    # 예수금 거래내역 삭제
    from app.models.deposit_transaction import DepositTransaction
    from app.api.v1.deposit_accounts import recalculate_balances

    txn_result = await db.execute(
        select(DepositTransaction).where(
            DepositTransaction.investment_record_id == record_id
        )
    )
    txns = txn_result.scalars().all()
    affected_account_ids = set()
    for txn in txns:
        affected_account_ids.add(txn.deposit_account_id)
        await db.delete(txn)

    await db.delete(record)
    await db.flush()

    # 영향받은 계좌 잔액 재계산
    for acct_id in affected_account_ids:
        await recalculate_balances(acct_id, db)

    await db.commit()
