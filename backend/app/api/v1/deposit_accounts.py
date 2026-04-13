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
    """customer_id에 해당하는 예수금 계좌 목록 반환."""
    stmt = select(DepositAccount).where(DepositAccount.customer_id == customer_id)
    if not include_hidden:
        stmt = stmt.where(DepositAccount.is_active == True)
    stmt = stmt.order_by(DepositAccount.created_at)
    result = await db.execute(stmt)
    accounts = result.scalars().all()
    return accounts


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
