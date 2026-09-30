"""권한 판정 단일 지점 (docs/login_logic, 지시서 6.1).

이 파일 밖에서 role 을 비교하지 말 것. 라우터는 여기 함수를 "호출만" 한다.

규칙은 하나뿐이다.
    접근 가능 = (요청자가 대표) OR (대상 고객의 담당자 == 요청자)

데이터 3계층 (지시서 4.2)
    A. 고객 귀속  : clients.user_id 기준. 대표 전체 / 매니저는 담당 고객 것만
    B. 매니저 개인: row.user_id 기준.   대표 전체 / 매니저는 본인 것만
    C. 전사 공용  : 읽기 전원 / 쓰기 대표만

응답 규칙
    - 권한 없는 리소스 → 404 (존재 자체를 숨긴다)
    - 역할이 부족해 기능 자체를 못 쓰는 경우 → 403

여기서 actor 는 "실효 사용자(effective)" 다. 대행 로그인 중이면 매니저이므로
대표도 매니저와 똑같은 화면을 보게 된다. 실제 행위자(대표)는 감사 로그와
forbid_while_impersonating 판정에만 쓰인다.
"""
from __future__ import annotations

from typing import TYPE_CHECKING, Any, Optional

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.sql import Select

from app.models.client import Client, ClientAccount
from app.models.customer_retirement_profile import CustomerRetirementProfile
from app.models.user import User

if TYPE_CHECKING:  # pragma: no cover
    from app.core.deps import AuthContext

OWNER = "owner"
MANAGER = "manager"
ROLES = (OWNER, MANAGER)


# ── 역할 ──────────────────────────────────────────────────────────


def is_owner(actor: User) -> bool:
    return getattr(actor, "role", None) == OWNER


def is_manager(actor: User) -> bool:
    return getattr(actor, "role", None) == MANAGER


def require_owner(actor: User) -> None:
    """역할 자체가 부족한 경우 → 403. 리소스 은닉이 아니라 기능 차단이다."""
    if not is_owner(actor):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="대표 계정만 사용할 수 있는 기능입니다.",
        )


def not_found() -> HTTPException:
    """권한 없는 리소스는 존재를 숨긴다 → 404."""
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="대상을 찾을 수 없습니다.")


def effective_manager_filter(actor: User, manager_id: Optional[str]) -> Optional[str]:
    """목록 조회 시 적용할 담당자 id. None 이면 필터 없음(대표 전체).

    - 매니저: 항상 본인 (manager_id 를 보내도 무시 — 에러 아님, 지시서 8.2)
    - 대표  : manager_id 를 보냈으면 그 매니저, 아니면 전체
    """
    if not is_owner(actor):
        return actor.id
    return manager_id or None


# ── 대행 로그인 ────────────────────────────────────────────────────


def is_valid_impersonation(actor: User, target: User) -> bool:
    """대표 → 활성 매니저 방향만 허용."""
    return (
        is_owner(actor)
        and is_manager(target)
        and bool(target.is_active)
        and actor.id != target.id
    )


def forbid_while_impersonating(ctx: "AuthContext") -> None:
    """대행은 '매니저 업무 대신 처리'이지 '계정 장악'이 아니다 (지시서 7.3)."""
    if ctx.is_impersonating:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="대행 로그인 중에는 사용할 수 없습니다. 본인 계정으로 돌아간 뒤 실행하세요.",
        )


# ── 계층 A: 고객 귀속 ──────────────────────────────────────────────


def scope_clients(stmt: Select, actor: User, manager_id: Optional[str] = None) -> Select:
    """clients 가 FROM(또는 JOIN)에 포함된 쿼리에 소유권 조건을 덧붙인다."""
    owner_id = effective_manager_filter(actor, manager_id)
    if owner_id is None:
        return stmt
    return stmt.where(Client.user_id == owner_id)


def client_ids_subquery(actor: User, manager_id: Optional[str] = None) -> Optional[Select]:
    """접근 가능한 clients.id 서브쿼리. None 이면 제한 없음(대표 전체)."""
    owner_id = effective_manager_filter(actor, manager_id)
    if owner_id is None:
        return None
    return select(Client.id).where(Client.user_id == owner_id)


def profile_ids_subquery(actor: User, manager_id: Optional[str] = None) -> Optional[Select]:
    """접근 가능한 customer_retirement_profiles.id 서브쿼리. None 이면 제한 없음."""
    owner_id = effective_manager_filter(actor, manager_id)
    if owner_id is None:
        return None
    return (
        select(CustomerRetirementProfile.id)
        .join(Client, CustomerRetirementProfile.customer_id == Client.id)
        .where(Client.user_id == owner_id)
    )


def account_ids_subquery(actor: User, manager_id: Optional[str] = None) -> Optional[Select]:
    """접근 가능한 client_accounts.id 서브쿼리. None 이면 제한 없음."""
    owner_id = effective_manager_filter(actor, manager_id)
    if owner_id is None:
        return None
    return (
        select(ClientAccount.id)
        .join(Client, ClientAccount.client_id == Client.id)
        .where(Client.user_id == owner_id)
    )


def scope_by_client_column(stmt: Select, column: Any, actor: User, manager_id: Optional[str] = None) -> Select:
    """clients.id 를 가리키는 컬럼(FK 유무 무관)으로 스코프를 건다."""
    sub = client_ids_subquery(actor, manager_id)
    return stmt if sub is None else stmt.where(column.in_(sub))


def scope_by_profile_column(stmt: Select, column: Any, actor: User, manager_id: Optional[str] = None) -> Select:
    """customer_retirement_profiles.id 를 가리키는 컬럼으로 스코프를 건다."""
    sub = profile_ids_subquery(actor, manager_id)
    return stmt if sub is None else stmt.where(column.in_(sub))


def scope_by_account_column(stmt: Select, column: Any, actor: User, manager_id: Optional[str] = None) -> Select:
    """client_accounts.id 를 가리키는 컬럼으로 스코프를 건다."""
    sub = account_ids_subquery(actor, manager_id)
    return stmt if sub is None else stmt.where(column.in_(sub))


def scope_by_suggestion_column(stmt: Select, column: Any, actor: User, manager_id: Optional[str] = None) -> Select:
    """portfolio_suggestions.id 를 가리키는 컬럼으로 스코프를 건다.

    컬럼이 NULL 인 행(연결된 제안이 없는 예약 등)은 담당자를 알 수 없으므로 대표에게만 보인다.
    """
    sub = account_ids_subquery(actor, manager_id)
    if sub is None:
        return stmt
    from app.models.portfolio_suggestion import PortfolioSuggestion

    return stmt.where(column.in_(select(PortfolioSuggestion.id).where(PortfolioSuggestion.account_id.in_(sub))))


async def assert_client(db, actor: User, client_id: str) -> Client:
    """소유 조건을 건 채로 고객을 조회. 없거나 권한 없으면 404."""
    stmt = scope_clients(select(Client).where(Client.id == client_id), actor)
    client = (await db.execute(stmt)).scalar_one_or_none()
    if client is None:
        raise not_found()
    return client


async def assert_account(db, actor: User, account_id: str) -> ClientAccount:
    stmt = (
        select(ClientAccount)
        .join(Client, ClientAccount.client_id == Client.id)
        .where(ClientAccount.id == account_id)
    )
    row = (await db.execute(scope_clients(stmt, actor))).scalar_one_or_none()
    if row is None:
        raise not_found()
    return row


async def assert_profile(db, actor: User, profile_id: str) -> CustomerRetirementProfile:
    """customer_retirement_profiles.id 로 조회."""
    stmt = (
        select(CustomerRetirementProfile)
        .join(Client, CustomerRetirementProfile.customer_id == Client.id)
        .where(CustomerRetirementProfile.id == profile_id)
    )
    row = (await db.execute(scope_clients(stmt, actor))).scalar_one_or_none()
    if row is None:
        raise not_found()
    return row


async def find_profile_by_customer(db, actor: User, customer_id: str) -> Optional[CustomerRetirementProfile]:
    """clients.id 로 은퇴 프로필 조회(소유 조건 포함). 없으면 None — 호출부가 404/자동생성 결정."""
    stmt = (
        select(CustomerRetirementProfile)
        .join(Client, CustomerRetirementProfile.customer_id == Client.id)
        .where(CustomerRetirementProfile.customer_id == customer_id)
    )
    return (await db.execute(scope_clients(stmt, actor))).scalar_one_or_none()


async def assert_profile_by_customer(db, actor: User, customer_id: str) -> CustomerRetirementProfile:
    row = await find_profile_by_customer(db, actor, customer_id)
    if row is None:
        raise not_found()
    return row


async def assert_snapshot(db, actor: User, snapshot_id: str):
    """스냅샷 → 계좌 → 고객 체인으로 소유권 확인."""
    from app.models.snapshot import PortfolioSnapshot

    stmt = (
        select(PortfolioSnapshot)
        .join(ClientAccount, ClientAccount.id == PortfolioSnapshot.client_account_id)
        .join(Client, Client.id == ClientAccount.client_id)
        .where(PortfolioSnapshot.id == snapshot_id)
    )
    row = (await db.execute(scope_clients(stmt, actor))).scalars().first()
    if row is None:
        raise not_found()
    return row


async def assert_suggestion(db, actor: User, suggestion_id: str):
    """포트폴리오 제안 → 계좌 → 고객 체인으로 소유권 확인."""
    from app.models.portfolio_suggestion import PortfolioSuggestion

    stmt = (
        select(PortfolioSuggestion)
        .join(ClientAccount, ClientAccount.id == PortfolioSuggestion.account_id)
        .join(Client, Client.id == ClientAccount.client_id)
        .where(PortfolioSuggestion.id == suggestion_id)
    )
    row = (await db.execute(scope_clients(stmt, actor))).scalars().first()
    if row is None:
        raise not_found()
    return row


async def assert_deposit_account(db, actor: User, deposit_account_id: int, customer_id: Optional[str] = None):
    """예수금 계좌 소유권 확인.

    deposit_accounts.customer_id(clients.id)에는 FK 가 없어(지시서 문제 A) 조인 대신
    접근 가능한 clients.id 서브쿼리로 판정한다. customer_id 를 주면 그 고객의 계좌인지도 확인.
    """
    from app.models.deposit_account import DepositAccount

    stmt = select(DepositAccount).where(DepositAccount.id == deposit_account_id)
    if customer_id is not None:
        stmt = stmt.where(DepositAccount.customer_id == customer_id)
    stmt = scope_by_client_column(stmt, DepositAccount.customer_id, actor)
    row = (await db.execute(stmt)).scalar_one_or_none()
    if row is None:
        raise not_found()
    return row


def can_access_client_row(actor: User, client: Optional[Client]) -> bool:
    """이미 로드된 Client 에 대한 판정 (조인 조회가 불가능한 경우에만 사용)."""
    if client is None:
        return False
    return is_owner(actor) or client.user_id == actor.id


# ── 계층 B: 매니저 개인 자료 ────────────────────────────────────────


def scope_own(stmt: Select, model: Any, actor: User, manager_id: Optional[str] = None) -> Select:
    owner_id = effective_manager_filter(actor, manager_id)
    if owner_id is None:
        return stmt
    return stmt.where(model.user_id == owner_id)


def assert_own(row: Any, actor: User) -> Any:
    if row is None:
        raise not_found()
    if not is_owner(actor) and getattr(row, "user_id", None) != actor.id:
        raise not_found()
    return row


# ── 계층 C: 전사 공용 ──────────────────────────────────────────────


def require_master_write(actor: User) -> None:
    """공용 마스터·설정 쓰기(POST/PUT/PATCH/DELETE)는 대표만. 읽기는 제한하지 않는다."""
    require_owner(actor)
