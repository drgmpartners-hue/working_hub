"""Deposit accounts and transactions API endpoints.

Routes
------
GET    /retirement/deposit-accounts                           - 고객별 예수금 계좌 목록
POST   /retirement/deposit-accounts                           - 예수금 계좌 생성
PUT    /retirement/deposit-accounts/{id}                      - 예수금 계좌 수정
DELETE /retirement/deposit-accounts/{id}                      - 예수금 계좌 비활성화

GET    /retirement/deposit-accounts/{account_id}/transactions - 거래내역 목록
POST   /retirement/deposit-accounts/{account_id}/transactions - 거래내역 추가
PUT    /retirement/deposit-transactions/{id}                  - 거래내역 수정
DELETE /retirement/deposit-transactions/{id}                  - 거래내역 삭제
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.deposit_account import DepositAccount
from app.models.deposit_transaction import DepositTransaction
from app.models.user import User
from app.schemas.deposit_account import (
    DepositAccountCreate,
    DepositAccountResponse,
    DepositAccountUpdate,
    DepositTransactionCreate,
    DepositTransactionResponse,
    DepositTransactionUpdate,
)

router = APIRouter(prefix="/retirement/deposit-accounts", tags=["deposit-accounts"])


# ---------------------------------------------------------------------------
# Helper: 잔액 재계산
# ---------------------------------------------------------------------------


async def recalculate_balances(account_id: int, db: AsyncSession) -> None:
    """해당 계좌의 모든 거래를 날짜순으로 정렬하여 잔액 재계산."""
    result = await db.execute(
        select(DepositTransaction)
        .where(DepositTransaction.deposit_account_id == account_id)
        .order_by(DepositTransaction.transaction_date, DepositTransaction.id)
    )
    txns = result.scalars().all()
    balance = 0
    for txn in txns:
        balance += txn.credit_amount - txn.debit_amount
        txn.balance = balance


# ---------------------------------------------------------------------------
# POST /retirement/deposit-accounts/{id}/recalculate
# ---------------------------------------------------------------------------

@router.post(
    "/{account_id}/recalculate",
    summary="예수금 계좌 투자기록 기반 재계산",
    status_code=200,
)
async def recalculate_account(
    account_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """투자기록 기반으로 자동생성된 거래를 일괄 재동기화하고 잔액을 재계산합니다."""
    from app.models.investment_record import InvestmentRecord

    # 1. 해당 계좌에 연결된 투자기록 조회
    rec_result = await db.execute(
        select(InvestmentRecord).where(InvestmentRecord.deposit_account_id == account_id)
    )
    records = rec_result.scalars().all()

    updated_count = 0

    for record in records:
        # 상품명 조회
        product_label = record.product_name or ""
        if record.wrap_account_id:
            from app.models.wrap_account import WrapAccount
            wa_r = await db.execute(select(WrapAccount).where(WrapAccount.id == record.wrap_account_id))
            wa = wa_r.scalar_one_or_none()
            if wa:
                product_label = wa.product_name

        # 투자(출금) 거래 동기화
        invest_r = await db.execute(
            select(DepositTransaction).where(
                DepositTransaction.investment_record_id == record.id,
                DepositTransaction.transaction_type == "investment",
            )
        )
        invest_txn = invest_r.scalar_one_or_none()
        if invest_txn:
            invest_txn.transaction_date = record.start_date
            invest_txn.debit_amount = record.investment_amount
            invest_txn.related_product = product_label
            updated_count += 1

        # 종결(입금) 거래 동기화
        if record.status == "exit" and record.evaluation_amount:
            term_r = await db.execute(
                select(DepositTransaction).where(
                    DepositTransaction.investment_record_id == record.id,
                    DepositTransaction.transaction_type == "termination",
                )
            )
            term_txn = term_r.scalar_one_or_none()
            term_date = record.actual_maturity_date or record.end_date or record.start_date
            if term_txn:
                term_txn.transaction_date = term_date
                term_txn.credit_amount = record.evaluation_amount
                term_txn.related_product = product_label
                term_txn.memo = f"{product_label} 종결 (투자: {record.start_date})"
                updated_count += 1

    # 2. 잔액 재계산
    await db.flush()
    await recalculate_balances(account_id, db)
    await db.commit()

    return {"message": f"{updated_count}건 동기화 완료", "updated_count": updated_count}


# ---------------------------------------------------------------------------
# GET /retirement/deposit-accounts?customer_id={cid}
# ---------------------------------------------------------------------------


@router.get(
    "",
    response_model=list[DepositAccountResponse],
    summary="고객별 예수금 계좌 목록",
)
async def list_deposit_accounts(
    customer_id: str = Query(..., description="고객 ID"),
    include_hidden: bool = Query(False, description="숨긴 계좌 포함 여부"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """customer_id에 해당하는 예수금 계좌 목록 반환 (current_balance 포함)."""
    stmt = select(DepositAccount).where(DepositAccount.customer_id == customer_id)
    if not include_hidden:
        stmt = stmt.where(DepositAccount.is_active == True)
    stmt = stmt.order_by(DepositAccount.created_at)
    result = await db.execute(stmt)
    accounts = result.scalars().all()

    # 각 계좌의 마지막 거래 잔액 계산
    from app.models.deposit_transaction import DepositTransaction
    response_list = []
    for acct in accounts:
        last_tx = await db.execute(
            select(DepositTransaction)
            .where(DepositTransaction.deposit_account_id == acct.id)
            .order_by(DepositTransaction.transaction_date.desc(), DepositTransaction.id.desc())
            .limit(1)
        )
        last = last_tx.scalar_one_or_none()
        balance = last.balance if last else 0
        resp = DepositAccountResponse.model_validate(acct)
        resp.current_balance = balance
        response_list.append(resp)
    return response_list


# ---------------------------------------------------------------------------
# POST /retirement/deposit-accounts
# ---------------------------------------------------------------------------


@router.post(
    "",
    response_model=DepositAccountResponse,
    status_code=status.HTTP_201_CREATED,
    summary="예수금 계좌 생성",
)
async def create_deposit_account(
    payload: DepositAccountCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """새 예수금 계좌를 생성합니다."""
    account = DepositAccount(
        profile_id=payload.profile_id or "",
        customer_id=payload.customer_id,
        securities_company=payload.securities_company,
        account_number=payload.account_number,
        nickname=payload.nickname,
    )
    db.add(account)
    await db.commit()
    await db.refresh(account)
    return account


# ---------------------------------------------------------------------------
# PUT /retirement/deposit-accounts/{account_id}
# ---------------------------------------------------------------------------


@router.put(
    "/{account_id}",
    response_model=DepositAccountResponse,
    summary="예수금 계좌 수정",
)
async def update_deposit_account(
    account_id: int,
    payload: DepositAccountUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """예수금 계좌 정보를 부분 수정합니다."""
    account: DepositAccount | None = await db.get(DepositAccount, account_id)
    if account is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"DepositAccount {account_id} not found",
        )

    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(account, field, value)

    await db.commit()
    await db.refresh(account)
    return account


# ---------------------------------------------------------------------------
# DELETE /retirement/deposit-accounts/{account_id}
# ---------------------------------------------------------------------------


@router.delete(
    "/{account_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="예수금 계좌 비활성화",
)
async def deactivate_deposit_account(
    account_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """예수금 계좌를 비활성화합니다 (소프트 삭제)."""
    account: DepositAccount | None = await db.get(DepositAccount, account_id)
    if account is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"DepositAccount {account_id} not found",
        )

    account.is_active = False
    await db.commit()


# ---------------------------------------------------------------------------
# GET /retirement/deposit-accounts/{account_id}/transactions
# ---------------------------------------------------------------------------


@router.get(
    "/{account_id}/transactions",
    response_model=list[DepositTransactionResponse],
    summary="거래내역 목록",
)
async def list_transactions(
    account_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """계좌별 거래내역을 날짜순으로 반환합니다."""
    # 계좌 존재 확인
    account: DepositAccount | None = await db.get(DepositAccount, account_id)
    if account is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"DepositAccount {account_id} not found",
        )

    stmt = (
        select(DepositTransaction)
        .where(DepositTransaction.deposit_account_id == account_id)
        .order_by(DepositTransaction.transaction_date, DepositTransaction.id)
    )
    result = await db.execute(stmt)
    txns = result.scalars().all()
    return txns


# ---------------------------------------------------------------------------
# POST /retirement/deposit-accounts/{account_id}/transactions
# ---------------------------------------------------------------------------


@router.post(
    "/{account_id}/transactions",
    response_model=DepositTransactionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="거래내역 추가",
)
async def create_transaction(
    account_id: int,
    payload: DepositTransactionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """거래내역을 추가하고 해당 계좌의 모든 잔액을 재계산합니다."""
    # 계좌 존재 확인
    account: DepositAccount | None = await db.get(DepositAccount, account_id)
    if account is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"DepositAccount {account_id} not found",
        )

    txn = DepositTransaction(
        deposit_account_id=account_id,
        transaction_date=payload.transaction_date,
        transaction_type=payload.transaction_type,
        related_product=payload.related_product,
        investment_record_id=payload.investment_record_id,
        credit_amount=payload.credit_amount,
        debit_amount=payload.debit_amount,
        memo=payload.memo,
    )
    db.add(txn)
    await db.flush()  # id 확보

    # 잔액 재계산
    await recalculate_balances(account_id, db)

    await db.commit()
    await db.refresh(txn)
    return txn


# ---------------------------------------------------------------------------
# PUT /retirement/deposit-transactions/{transaction_id}
# (별도 prefix 없이 동일 router에 등록 - path가 달라 충돌 없음)
# ---------------------------------------------------------------------------

# 거래내역 수정/삭제는 prefix가 다르므로 별도 router로 분리
transactions_router = APIRouter(
    prefix="/retirement/deposit-transactions", tags=["deposit-accounts"]
)


@transactions_router.put(
    "/{transaction_id}",
    response_model=DepositTransactionResponse,
    summary="거래내역 수정",
)
async def update_transaction(
    transaction_id: int,
    payload: DepositTransactionUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """거래내역을 수정하고 해당 계좌의 모든 잔액을 재계산합니다."""
    txn: DepositTransaction | None = await db.get(DepositTransaction, transaction_id)
    if txn is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"DepositTransaction {transaction_id} not found",
        )

    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(txn, field, value)

    # 잔액 재계산
    await recalculate_balances(txn.deposit_account_id, db)

    await db.commit()
    await db.refresh(txn)
    return txn


@transactions_router.delete(
    "/{transaction_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="거래내역 삭제",
)
async def delete_transaction(
    transaction_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """거래내역을 삭제하고 해당 계좌의 모든 잔액을 재계산합니다."""
    txn: DepositTransaction | None = await db.get(DepositTransaction, transaction_id)
    if txn is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"DepositTransaction {transaction_id} not found",
        )

    account_id = txn.deposit_account_id
    await db.delete(txn)
    await db.flush()

    # 잔액 재계산
    await recalculate_balances(account_id, db)

    await db.commit()
