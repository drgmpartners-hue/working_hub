"""대표 전용 통합 현황 집계 (docs/login_logic P4, 결정 D-3).

대표가 매니저 계정으로 전환하지 않고도 한 화면에서 매니저별 고객·계좌·업무 자료를 본다.
권한 판정은 라우터에서 require_owner 로 끝낸 뒤 이 모듈을 호출한다(여기서는 판정하지 않음).
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta
from typing import Any, Optional

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit_log import AuditLog
from app.models.client import Client, ClientAccount
from app.models.commission import CommissionCalculation
from app.models.content import ContentProject
from app.models.message_log import MessageLog
from app.models.portfolio import PortfolioAnalysis
from app.models.user import User


async def _count_by_user(db: AsyncSession, column, since: Optional[datetime] = None, created_col=None) -> dict[str, int]:
    stmt = select(column, func.count()).group_by(column)
    if since is not None and created_col is not None:
        stmt = stmt.where(created_col >= since)
    return {k: int(v) for k, v in (await db.execute(stmt)).all() if k}


async def _account_counts(db: AsyncSession) -> dict[str, int]:
    stmt = (
        select(Client.user_id, func.count(ClientAccount.id))
        .join(ClientAccount, ClientAccount.client_id == Client.id)
        .group_by(Client.user_id)
    )
    return {k: int(v) for k, v in (await db.execute(stmt)).all()}


def user_brief(u: User) -> dict[str, Any]:
    return {
        "id": u.id,
        "email": u.email,
        "nickname": u.nickname,
        "phone": u.phone,
        "role": u.role,
        "is_active": bool(u.is_active),
        "last_login": u.last_login,
        "created_at": u.created_at,
        "deactivated_at": u.deactivated_at,
        "allowed_programs": u.allowed_programs,  # None = 전부 (docs/login_logic P11)
        "programs": u.programs,
    }


async def user_stats(db: AsyncSession) -> dict[str, dict[str, int]]:
    """사용자별 집계: 고객·계좌·수당 정산·콘텐츠·포트폴리오 분석·최근 7일 문자."""
    week_ago = datetime.utcnow() - timedelta(days=7)
    clients = await _count_by_user(db, Client.user_id)
    accounts = await _account_counts(db)
    commissions = await _count_by_user(db, CommissionCalculation.user_id)
    contents = await _count_by_user(db, ContentProject.user_id)
    analyses = await _count_by_user(db, PortfolioAnalysis.user_id)
    messages_7d = await _count_by_user(db, MessageLog.user_id, since=week_ago, created_col=MessageLog.sent_at)
    new_clients_7d = await _count_by_user(db, Client.user_id, since=week_ago, created_col=Client.created_at)
    ids = set(clients) | set(accounts) | set(commissions) | set(contents) | set(analyses) | set(messages_7d)
    return {
        uid: {
            "clients": clients.get(uid, 0),
            "accounts": accounts.get(uid, 0),
            "commission_calculations": commissions.get(uid, 0),
            "content_projects": contents.get(uid, 0),
            "portfolio_analyses": analyses.get(uid, 0),
            "messages_7d": messages_7d.get(uid, 0),
            "new_clients_7d": new_clients_7d.get(uid, 0),
        }
        for uid in ids
    }


EMPTY_STATS = {
    "clients": 0,
    "accounts": 0,
    "commission_calculations": 0,
    "content_projects": 0,
    "portfolio_analyses": 0,
    "messages_7d": 0,
    "new_clients_7d": 0,
}


async def list_users_with_stats(db: AsyncSession) -> list[dict[str, Any]]:
    users = (await db.execute(select(User).order_by(User.role.desc(), User.created_at))).scalars().all()
    stats = await user_stats(db)
    return [{**user_brief(u), "stats": stats.get(u.id, dict(EMPTY_STATS))} for u in users]


async def overview(db: AsyncSession) -> dict[str, Any]:
    people = await list_users_with_stats(db)
    active = [p for p in people if p["is_active"]]
    inactive_ids = [p["id"] for p in people if not p["is_active"]]
    # 비활성(퇴사) 계정에 남아 있는 고객 = 사실상 담당자 없음 → 이관 필요
    unassigned = 0
    if inactive_ids:
        unassigned = int(
            (await db.execute(select(func.count()).select_from(Client).where(Client.user_id.in_(inactive_ids)))).scalar_one()
        )
    recent = (
        await db.execute(select(AuditLog).order_by(AuditLog.created_at.desc()).limit(20))
    ).scalars().all()
    names = {p["id"]: p["nickname"] for p in people}
    return {
        "totals": {
            "managers": sum(1 for p in active if p["role"] == "manager"),
            "owners": sum(1 for p in active if p["role"] == "owner"),
            "clients": sum(p["stats"]["clients"] for p in people),
            "accounts": sum(p["stats"]["accounts"] for p in people),
            "commission_calculations": sum(p["stats"]["commission_calculations"] for p in people),
            "content_projects": sum(p["stats"]["content_projects"] for p in people),
            "portfolio_analyses": sum(p["stats"]["portfolio_analyses"] for p in people),
        },
        "by_manager": people,
        "unassigned_clients": unassigned,
        "recent_activity": [
            {
                "created_at": a.created_at,
                "actor": names.get(a.actor_user_id),
                "effective": names.get(a.effective_user_id),
                "is_impersonated": a.is_impersonated,
                "action": a.action,
                "resource_type": a.resource_type,
                "resource_id": a.resource_id,
            }
            for a in recent
        ],
    }


async def manager_summary(db: AsyncSession, user: User, limit: int = 10) -> dict[str, Any]:
    """한 매니저의 담당 고객과 개인 업무 자료(최근 항목)를 한 번에."""
    stats = (await user_stats(db)).get(user.id, dict(EMPTY_STATS))
    clients = (
        await db.execute(
            select(Client.id, Client.name, Client.unique_code, Client.created_at, func.count(ClientAccount.id))
            .outerjoin(ClientAccount, ClientAccount.client_id == Client.id)
            .where(Client.user_id == user.id)
            .group_by(Client.id)
            .order_by(Client.created_at.desc())
        )
    ).all()
    commissions = (
        await db.execute(
            select(CommissionCalculation.id, CommissionCalculation.calc_type, CommissionCalculation.status, CommissionCalculation.created_at)
            .where(CommissionCalculation.user_id == user.id)
            .order_by(CommissionCalculation.created_at.desc())
            .limit(limit)
        )
    ).all()
    contents = (
        await db.execute(
            select(ContentProject.id, ContentProject.title, ContentProject.content_type, ContentProject.status, ContentProject.created_at)
            .where(ContentProject.user_id == user.id)
            .order_by(ContentProject.created_at.desc())
            .limit(limit)
        )
    ).all()
    analyses = (
        await db.execute(
            select(PortfolioAnalysis.id, PortfolioAnalysis.data_source, PortfolioAnalysis.status, PortfolioAnalysis.created_at)
            .where(PortfolioAnalysis.user_id == user.id)
            .order_by(PortfolioAnalysis.created_at.desc())
            .limit(limit)
        )
    ).all()
    messages = (
        await db.execute(
            select(MessageLog.id, MessageLog.message_type, MessageLog.message_summary, MessageLog.sent_at, Client.name)
            .join(Client, Client.id == MessageLog.client_id)
            .where(MessageLog.user_id == user.id)
            .order_by(MessageLog.sent_at.desc())
            .limit(limit)
        )
    ).all()
    return {
        "manager": user_brief(user),
        "stats": stats,
        "clients": [
            {"id": r[0], "name": r[1], "unique_code": r[2], "created_at": r[3], "accounts": int(r[4])} for r in clients
        ],
        "recent_commission_calculations": [
            {"id": r[0], "calc_type": r[1], "status": r[2], "created_at": r[3]} for r in commissions
        ],
        "recent_content_projects": [
            {"id": r[0], "title": r[1], "content_type": r[2], "status": r[3], "created_at": r[4]} for r in contents
        ],
        "recent_portfolio_analyses": [
            {"id": r[0], "data_source": r[1], "status": r[2], "created_at": r[3]} for r in analyses
        ],
        "recent_messages": [
            {"id": r[0], "message_type": r[1], "summary": r[2], "sent_at": r[3], "client_name": r[4]} for r in messages
        ],
    }


async def audit_logs(
    db: AsyncSession,
    *,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    user_id: Optional[str] = None,
    client_id: Optional[str] = None,
    action: Optional[str] = None,
    impersonated: Optional[bool] = None,
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    """감사 로그 목록 (최신순) + 사람·고객 이름."""
    conds = []
    if date_from:
        conds.append(AuditLog.created_at >= datetime.combine(date_from, time.min))
    if date_to:
        conds.append(AuditLog.created_at <= datetime.combine(date_to, time.max))
    if user_id:
        conds.append(or_(AuditLog.actor_user_id == user_id, AuditLog.effective_user_id == user_id))
    if client_id:
        conds.append(AuditLog.client_id == client_id)
    if action:
        conds.append(AuditLog.action == action)
    if impersonated is not None:
        conds.append(AuditLog.is_impersonated == impersonated)

    total = int((await db.execute(select(func.count()).select_from(AuditLog).where(*conds))).scalar_one())
    rows = (
        await db.execute(
            select(AuditLog).where(*conds).order_by(AuditLog.created_at.desc()).limit(limit).offset(offset)
        )
    ).scalars().all()

    user_ids = {r.actor_user_id for r in rows} | {r.effective_user_id for r in rows}
    names: dict[str, str] = {}
    if user_ids - {None}:
        for uid, nick in (await db.execute(select(User.id, User.nickname).where(User.id.in_(user_ids - {None})))).all():
            names[uid] = nick
    client_ids = {r.client_id for r in rows if r.client_id}
    cnames: dict[str, str] = {}
    if client_ids:
        for cid, nm in (await db.execute(select(Client.id, Client.name).where(Client.id.in_(client_ids)))).all():
            cnames[cid] = nm
    return {
        "total": total,
        "items": [
            {
                "id": r.id,
                "created_at": r.created_at,
                "actor_id": r.actor_user_id,
                "actor": names.get(r.actor_user_id),
                "effective_id": r.effective_user_id,
                "effective": names.get(r.effective_user_id),
                "is_impersonated": r.is_impersonated,
                "action": r.action,
                "resource_type": r.resource_type,
                "resource_id": r.resource_id,
                "client_id": r.client_id,
                "client_name": cnames.get(r.client_id) if r.client_id else None,
                "method": r.method,
                "path": r.path,
                "status_code": r.status_code,
                "ip": r.ip,
            }
            for r in rows
        ],
    }
