"""중복 고객 합치기 (2026-10-07) — 계좌 있는 기록을 남기고, 고유번호는 먼저 등록된(고객 정보 관리) 쪽, 두 포털 링크 모두 유지."""
import uuid
from datetime import date, datetime

import pytest

from tests.test_permissions import PG, env  # noqa: F401  (앱 설정보다 먼저)


def _code() -> str:
    return str(uuid.uuid4().int)[:6]


async def _mk(Session, uid, name, birth, created, code, with_account=False, msg=False, profile=False):
    from app.models.client import Client, ClientAccount
    from app.models.customer_retirement_profile import CustomerRetirementProfile
    from app.models.message_log import MessageLog
    from app.models.snapshot import PortfolioSnapshot

    async with Session() as db:
        c = Client(id=str(uuid.uuid4()), user_id=uid, name=name, birth_date=birth, phone="010-1111-2222",
                   unique_code=code, created_at=created, portal_token=str(uuid.uuid4()))
        db.add(c)
        await db.flush()
        if with_account:
            a = ClientAccount(id=str(uuid.uuid4()), client_id=c.id, account_type="irp", securities_company="NH투자증권")
            db.add(a)
            await db.flush()
            db.add(PortfolioSnapshot(id=str(uuid.uuid4()), client_account_id=a.id, snapshot_date=date(2026, 9, 1), total_assets=1000))
        if msg:
            db.add(MessageLog(user_id=uid, client_id=c.id, message_type="sms", message_summary="안내", sent_at=datetime(2026, 9, 1)))
        if profile:
            db.add(CustomerRetirementProfile(customer_id=c.id, target_retirement_fund=0, desired_pension_amount=0,
                                             age_at_design=45, current_age=45, desired_retirement_age=60))
        await db.commit()
        return c.id, c.portal_token


@pytest.mark.skipif(not PG, reason="PERM_PG_URL 없음(실제 PostgreSQL 필요)")
async def test_find_and_merge_duplicate_clients(env):  # noqa: F811
    from sqlalchemy import func, select

    from app.models.client import Client, ClientAccount
    from app.models.message_log import MessageLog
    from app.services import client_portal_service

    c, d, hdr, Session = env["c"], env["d"], env["hdr"], env["Session"]
    name = "합치기" + uuid.uuid4().hex[:6]
    birth = date(1984, 9, 11)
    code_first, code_second = _code(), _code()
    # 3/24 고객 정보 관리 등록분(계좌 없음, 문자 기록 있음) / 3/25 주식·펀드 관리 등록분(계좌·분석 기록)
    x_id, x_tok = await _mk(Session, d["A"], name, birth, datetime(2026, 3, 24, 9), code_first, msg=True)
    y_id, y_tok = await _mk(Session, d["A"], name, birth, datetime(2026, 3, 25, 9), code_second, with_account=True, profile=True)
    # 이름은 같지만 담당자가 다른 고객은 같은 고객으로 보지 않음
    await _mk(Session, d["B"], name, birth, datetime(2026, 3, 26, 9), _code())

    assert (await c.get("/admin/duplicate-clients", headers=hdr(d["A"]))).status_code == 403  # 대표 전용
    groups = (await c.get("/admin/duplicate-clients", headers=hdr(d["owner"]))).json()["groups"]
    g = next(x for x in groups if x["name"] == name)
    assert len(g["records"]) == 2 and g["keep_id"] == y_id and g["code_after"] == code_first and not g["blocked"]
    rec = {r["id"]: r for r in g["records"]}
    assert rec[y_id]["linked"]["계좌"] == 1 and rec[y_id]["linked"]["분석 기록"] == 1 and rec[x_id]["linked"]["문자 기록"] == 1

    r = await c.post("/admin/duplicate-clients/merge", headers=hdr(d["owner"]),
                     json={"groups": [{"keep_id": y_id, "remove_ids": [x_id]}]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert not body["failed"] and body["merged"][0]["unique_code"] == code_first

    async with Session() as db:
        assert await db.get(Client, x_id) is None
        keep = await db.get(Client, y_id)
        assert keep.unique_code == code_first and keep.portal_token == y_tok and keep.portal_token_alt == x_tok
        assert (await db.execute(select(func.count()).select_from(ClientAccount).where(ClientAccount.client_id == y_id))).scalar() == 1
        assert (await db.execute(select(func.count()).select_from(MessageLog).where(MessageLog.client_id == y_id))).scalar() == 1
        # 두 포털 링크 모두 같은 고객으로 열린다
        assert (await client_portal_service.get_client_by_portal_token(db, x_tok)).id == y_id
        assert (await client_portal_service.get_client_by_portal_token(db, y_tok)).id == y_id

    # 고객 정보 관리에서 이제 계좌가 보인다
    accs = (await c.get(f"/clients/{y_id}/accounts", headers=hdr(d["A"]))).json()
    assert len(accs) == 1 and accs[0]["securities_company"] == "NH투자증권"
    groups = (await c.get("/admin/duplicate-clients", headers=hdr(d["owner"]))).json()["groups"]
    assert not [x for x in groups if x["name"] == name]


@pytest.mark.skipif(not PG, reason="PERM_PG_URL 없음(실제 PostgreSQL 필요)")
async def test_merge_blocked_when_both_have_retirement_plan(env):  # noqa: F811
    from app.models.client import Client

    c, d, hdr, Session = env["c"], env["d"], env["hdr"], env["Session"]
    name = "충돌" + uuid.uuid4().hex[:6]
    birth = date(1975, 1, 1)
    x_id, _ = await _mk(Session, d["A"], name, birth, datetime(2026, 3, 24), _code(), profile=True)
    y_id, _ = await _mk(Session, d["A"], name, birth, datetime(2026, 3, 25), _code(), with_account=True, profile=True)
    g = next(x for x in (await c.get("/admin/duplicate-clients", headers=hdr(d["owner"]))).json()["groups"] if x["name"] == name)
    assert g["blocked"]
    body = (await c.post("/admin/duplicate-clients/merge", headers=hdr(d["owner"]),
                         json={"groups": [{"keep_id": y_id, "remove_ids": [x_id]}]})).json()
    assert body["failed"] and not body["merged"]
    async with Session() as db:  # 아무것도 지워지지 않음
        assert await db.get(Client, x_id) is not None and await db.get(Client, y_id) is not None
