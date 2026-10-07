"""같은 고객이 두 번 등록된 경우 하나로 합치기 (2026-10-07).

원인: '주식, 펀드 관리 > 계좌정보 관리'에서 고객을 새로 등록하면, 고객 정보 관리에 이미 있는 고객과 별개의 고객이 생겼다.
그래서 고객 정보 관리 쪽 기록에는 계좌가 없고, 계좌·분석 기록은 다른 기록에 붙어 있었다.

같은 고객 판정: 이름 + 생년월일 + 담당자가 같고 생년월일이 비어 있지 않을 것.
합치는 방법
  - 남길 기록(keep) = 계좌가 더 많은 기록(같으면 연결된 기록이 더 많은 쪽, 그래도 같으면 나중 등록분).
    계좌에 딸린 분석 기록·제안·통화 예약은 계좌 id 로 붙어 있어 그대로 따라온다.
  - 지울 기록(remove)에 붙은 것(계좌·문자 기록·담당 이력·예수금 계좌·은퇴설계 프로필·보고서 출력·브리핑 수신자·감사 기록)을 keep 으로 옮긴다.
  - 고유번호는 먼저 등록된 기록(= 고객 정보 관리 쪽) 번호를 쓴다(대표 결정 2026-10-07).
  - 고객 포털 링크는 두 기록의 링크가 모두 열리도록 지운 쪽 링크를 portal_token_alt 에 남긴다.
  - 빈 칸(이메일·전화·주민번호·메모)은 다른 기록 값으로 채운다.
  - 은퇴설계 프로필이 양쪽에 다 있으면 어느 쪽이 맞는지 기계가 정할 수 없으므로 합치지 않고 건너뛴다(화면에 이유 표시).
"""
from __future__ import annotations

from collections import defaultdict
from typing import Optional

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit_log import AuditLog
from app.models.client import Client, ClientAccount
from app.models.client_transfer import ClientTransfer
from app.models.company_report import ReportExport
from app.models.customer_retirement_profile import CustomerRetirementProfile
from app.models.deposit_account import DepositAccount
from app.models.message_log import MessageLog
from app.models.news_briefing import BriefingRecipient
from app.models.snapshot import PortfolioSnapshot

# (모델, 고객 id 컬럼 이름, 화면 표시 이름)
_LINKS = [
    (ClientAccount, "client_id", "계좌"),
    (MessageLog, "client_id", "문자 기록"),
    (ClientTransfer, "client_id", "담당 이력"),
    (DepositAccount, "customer_id", "예수금 계좌"),
    (CustomerRetirementProfile, "customer_id", "은퇴설계"),
    (ReportExport, "client_id", "보고서 출력"),
    (BriefingRecipient, "client_id", "브리핑 수신"),
]


async def _counts(db: AsyncSession, ids: list[str]) -> dict[str, dict[str, int]]:
    out: dict[str, dict[str, int]] = {i: {} for i in ids}
    if not ids:
        return out
    for model, col, label in _LINKS:
        c = getattr(model, col)
        for cid, n in (await db.execute(select(c, func.count()).where(c.in_(ids)).group_by(c))).all():
            out[cid][label] = n
    rows = (await db.execute(
        select(ClientAccount.client_id, func.count(PortfolioSnapshot.id))
        .join(PortfolioSnapshot, PortfolioSnapshot.client_account_id == ClientAccount.id)
        .where(ClientAccount.client_id.in_(ids)).group_by(ClientAccount.client_id)
    )).all()
    for cid, n in rows:
        out[cid]["분석 기록"] = n
    return out


def _score(c: Client, cnt: dict[str, int]) -> tuple:
    return (cnt.get("계좌", 0), sum(cnt.values()), c.created_at)


async def find_duplicates(db: AsyncSession) -> list[dict]:
    """같은 고객으로 보이는 묶음(2건 이상). 대표 전용 — 범위 제한 없이 전체를 본다."""
    clients = (await db.execute(select(Client).where(Client.birth_date.isnot(None)))).scalars().all()
    groups: dict[tuple, list[Client]] = defaultdict(list)
    for c in clients:
        groups[((c.name or "").strip(), c.birth_date, c.user_id)].append(c)
    groups = {k: v for k, v in groups.items() if len(v) > 1}
    counts = await _counts(db, [c.id for v in groups.values() for c in v])
    out = []
    for (name, birth, _uid), members in sorted(groups.items(), key=lambda kv: kv[0][0]):
        keep = max(members, key=lambda c: _score(c, counts[c.id]))
        first = min(members, key=lambda c: c.created_at)
        both_profiles = sum(1 for c in members if counts[c.id].get("은퇴설계")) > 1
        out.append({
            "name": name,
            "birth_date": birth.isoformat() if birth else None,
            "keep_id": keep.id,
            "code_after": first.unique_code or keep.unique_code,
            "blocked": "양쪽 모두 은퇴설계가 있어 자동으로 합칠 수 없습니다(어느 쪽이 맞는지 확인 필요)." if both_profiles else None,
            "records": [
                {
                    "id": c.id,
                    "unique_code": c.unique_code,
                    "created_at": c.created_at.isoformat() if c.created_at else None,
                    "phone": c.phone,
                    "email": c.email,
                    "keep": c.id == keep.id,
                    "linked": counts[c.id],
                }
                for c in sorted(members, key=lambda c: c.created_at)
            ],
        })
    return out


async def merge_group(db: AsyncSession, keep_id: str, remove_ids: list[str]) -> dict:
    """remove_ids 의 기록을 keep_id 로 합치고 지운다. 한 트랜잭션(호출한 쪽에서 commit)."""
    keep = await db.get(Client, keep_id)
    removes = [await db.get(Client, i) for i in remove_ids]
    if keep is None or any(r is None for r in removes) or keep_id in remove_ids:
        raise ValueError("합칠 고객을 찾을 수 없습니다.")
    for r in removes:
        if (r.name or "").strip() != (keep.name or "").strip() or r.birth_date != keep.birth_date or r.user_id != keep.user_id:
            raise ValueError(f"{r.name}: 이름·생년월일·담당자가 같은 고객만 합칠 수 있습니다.")
    members = [keep, *removes]
    counts = await _counts(db, [c.id for c in members])
    if sum(1 for c in members if counts[c.id].get("은퇴설계")) > 1:
        raise ValueError(f"{keep.name}: 양쪽 모두 은퇴설계가 있어 자동으로 합칠 수 없습니다.")

    first = min(members, key=lambda c: c.created_at)
    code_after = first.unique_code or keep.unique_code
    alt_token: Optional[str] = None
    for r in sorted(removes, key=lambda c: c.created_at):
        if r.portal_token and r.portal_token != keep.portal_token and alt_token is None:
            alt_token = r.portal_token
    moved: dict[str, int] = defaultdict(int)

    for r in removes:
        for model, col, label in _LINKS:
            res = await db.execute(update(model).where(getattr(model, col) == r.id).values({col: keep.id}))
            moved[label] += res.rowcount or 0
        await db.execute(update(AuditLog).where(AuditLog.client_id == r.id).values(client_id=keep.id))
        for f in ("email", "phone", "ssn_encrypted", "memo"):
            if not getattr(keep, f, None) and getattr(r, f, None):
                setattr(keep, f, getattr(r, f))

    removed_codes = [r.unique_code for r in removes]
    for r in removes:
        # 딸린 기록은 위에서 모두 옮겼다. ORM delete 는 관계를 다시 읽으려 하므로(비동기에서 실패) 직접 지운다.
        db.expunge(r)
        await db.execute(delete(Client).where(Client.id == r.id))
    await db.flush()  # 지운 기록의 고유번호·링크가 비워진 뒤에 옮긴다(중복 불가 칸)
    keep.unique_code = code_after
    if alt_token and not keep.portal_token_alt:
        keep.portal_token_alt = alt_token
    await db.flush()
    return {"name": keep.name, "keep_id": keep.id, "unique_code": code_after,
            "removed": [r for r in remove_ids], "removed_codes": removed_codes, "moved": dict(moved)}
