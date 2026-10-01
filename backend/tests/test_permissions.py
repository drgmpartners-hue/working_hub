"""권한체계 데이터 격리 테스트 (docs/login_logic P8-1, 지시서 14.1).

실제 PostgreSQL 이 필요하다. 마이그레이션이 적용된 DB 를 가리키는 환경변수를 주면 실행된다.
    PERM_PG_URL=postgresql+asyncpg://user:pw@localhost:5432/db  pytest tests/test_permissions.py

시나리오: 대표(owner) 1명, 매니저 A·B 각 1명. A·B 가 각자 고객 1명씩 담당.
테스트 데이터는 이메일 접두사 perm- 로 만들고 시작할 때 지운다.
"""
import os
import uuid
from datetime import date

import pytest

PG = os.environ.get("PERM_PG_URL")
pytestmark = pytest.mark.skipif(not PG, reason="PERM_PG_URL 없음(실제 PostgreSQL 필요)")

if PG:
    os.environ["DATABASE_URL"] = PG
    os.environ.setdefault("SECRET_KEY", "perm-secret")


@pytest.fixture
async def env():
    """이벤트 루프마다 새 엔진(NullPool)을 만들어 get_db 를 대체한다."""
    import httpx
    from sqlalchemy import delete, select, text
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
    from sqlalchemy.pool import NullPool

    from app.core.config import settings
    from app.core.security import create_access_token, get_password_hash
    from app.db.session import get_db
    from app.main import app
    from app.models.client import Client, ClientAccount
    from app.models.customer_retirement_profile import CustomerRetirementProfile
    from app.models.user import User

    engine = create_async_engine(settings.ASYNC_DATABASE_URL, poolclass=NullPool)
    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async def _get_db():
        async with Session() as s:
            yield s

    app.dependency_overrides[get_db] = _get_db

    async with Session() as db:
        ids = (await db.execute(select(User.id).where(User.email.like("perm-%")))).scalars().all()
        if ids:
            await db.execute(text("DELETE FROM audit_logs WHERE actor_user_id = ANY(:i) OR effective_user_id = ANY(:i)"), {"i": list(ids)})
            await db.execute(delete(Client).where(Client.user_id.in_(ids)))
            await db.execute(delete(User).where(User.id.in_(ids)))
        await db.commit()

        def mk_user(nick, role):
            return User(
                email=f"perm-{uuid.uuid4().hex[:8]}@x.com",
                hashed_password=get_password_hash("pw"),
                nickname=nick,
                is_active=True,
                role=role,
            )

        owner, ma, mb = mk_user("대표", "owner"), mk_user("매니저A", "manager"), mk_user("매니저B", "manager")
        db.add_all([owner, ma, mb])
        await db.flush()

        data = {"owner": owner.id, "A": ma.id, "B": mb.id}
        for key, u in (("A", ma), ("B", mb)):
            c = Client(id=str(uuid.uuid4()), user_id=u.id, name=f"고객{key}", birth_date=date(1980, 1, 1))
            db.add(c)
            await db.flush()
            acc = ClientAccount(id=str(uuid.uuid4()), client_id=c.id, account_type="irp")
            db.add(acc)
            prof = CustomerRetirementProfile(
                customer_id=c.id, target_retirement_fund=0, desired_pension_amount=0,
                age_at_design=45, current_age=45, desired_retirement_age=60,
            )
            db.add(prof)
            await db.flush()
            data[f"client_{key}"] = c.id
            data[f"account_{key}"] = acc.id
            data[f"profile_{key}"] = prof.id
        await db.commit()

    def hdr(uid, **extra):
        return {"Authorization": f"Bearer {create_access_token(uid, extra_claims=extra or None)}"}

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t/api/v1") as c:
        yield {"c": c, "d": data, "hdr": hdr, "Session": Session}

    app.dependency_overrides.pop(get_db, None)
    await engine.dispose()


# ── 14.1 데이터 격리 ─────────────────────────────────────────────────


async def test_01_manager_sees_only_own_clients(env):
    c, d, hdr = env["c"], env["d"], env["hdr"]
    r = await c.get("/clients", headers=hdr(d["A"]))
    assert r.status_code == 200
    ids = {x["id"] for x in r.json()}
    assert d["client_A"] in ids and d["client_B"] not in ids


async def test_02_other_managers_client_is_404(env):
    c, d, hdr = env["c"], env["d"], env["hdr"]
    for method, path in [
        ("GET", f"/clients/{d['client_B']}"),
        ("PUT", f"/clients/{d['client_B']}"),
        ("DELETE", f"/clients/{d['client_B']}"),
        ("GET", f"/clients/{d['client_B']}/accounts"),
        ("PUT", f"/clients/{d['client_B']}/accounts/{d['account_B']}"),
        ("DELETE", f"/clients/{d['client_B']}/accounts/{d['account_B']}"),
        ("PATCH", f"/clients/{d['client_B']}"),
        ("POST", f"/clients/{d['client_B']}/send-portal-link"),
    ]:
        body = {} if method in ("PUT", "PATCH") else None
        r = await c.request(method, path, headers=hdr(d["A"]), json=body)
        assert r.status_code == 404, (method, path, r.status_code, r.text)


async def test_03_retirement_chain_is_404(env):
    c, d, hdr = env["c"], env["d"], env["hdr"]
    h = hdr(d["A"])
    assert (await c.get(f"/retirement/profiles/{d['client_B']}", headers=h)).status_code == 404
    assert (await c.put(f"/retirement/profiles/{d['client_B']}", headers=h, json={})).status_code == 404
    assert (await c.get(f"/retirement/desired-plans/{d['client_B']}", headers=h)).status_code == 404
    assert (await c.patch(f"/retirement/desired-plans/{d['client_B']}/params", headers=h, json={})).status_code == 404
    # 은퇴·연금 플랜 목록은 빈 목록 (A-목록 규칙)
    r = await c.get(f"/retirement/plans/{d['profile_B']}", headers=h)
    assert r.status_code == 200 and r.json() == []
    r = await c.get(f"/retirement/pension/{d['profile_B']}", headers=h)
    assert r.status_code == 200 and r.json() == []
    r = await c.post("/retirement/plans", headers=h, json={"profile_id": d["profile_B"], "current_age": 45, "annual_return_rate": 5})
    assert r.status_code == 404, r.text
    # 프로필 목록에도 B 고객 것은 없다
    r = await c.get("/retirement/profiles", headers=h)
    pids = {x["id"] for x in r.json()}
    assert d["profile_A"] in pids and d["profile_B"] not in pids


async def test_04_snapshot_routes_other_account_404(env):
    c, d, hdr = env["c"], env["d"], env["hdr"]
    h = hdr(d["A"])
    r = await c.get("/snapshots", params={"account_id": d["account_B"]}, headers=h)
    assert r.status_code == 404
    r = await c.get("/snapshots/latest-dates", headers=h)
    assert r.status_code == 200 and d["client_B"] not in r.json()


async def test_09_10_owner_sees_all_and_can_filter(env):
    c, d, hdr = env["c"], env["d"], env["hdr"]
    r = await c.get("/clients", headers=hdr(d["owner"]))
    ids = {x["id"] for x in r.json()}
    assert {d["client_A"], d["client_B"]} <= ids
    r = await c.get("/clients", params={"manager_id": d["A"]}, headers=hdr(d["owner"]))
    ids = {x["id"] for x in r.json()}
    assert d["client_A"] in ids and d["client_B"] not in ids
    # 매니저가 manager_id 를 보내면 무시 (에러 아님)
    r = await c.get("/clients", params={"manager_id": d["B"]}, headers=hdr(d["A"]))
    ids = {x["id"] for x in r.json()}
    assert d["client_A"] in ids and d["client_B"] not in ids


async def test_owner_can_access_manager_client_detail(env):
    c, d, hdr = env["c"], env["d"], env["hdr"]
    h = hdr(d["owner"])
    assert (await c.get(f"/clients/{d['client_B']}", headers=h)).status_code == 200
    assert (await c.get(f"/retirement/profiles/{d['client_B']}", headers=h)).status_code == 200


async def test_user_response_has_role(env):
    c, d, hdr = env["c"], env["d"], env["hdr"]
    r = await c.get("/users/me", headers=hdr(d["owner"]))
    assert r.json()["role"] == "owner"
    r = await c.get("/users/me", headers=hdr(d["A"]))
    assert r.json()["role"] == "manager"


async def _seed_more(env):
    """예수금 계좌·투자기록·문자 이력을 A·B 고객에 하나씩."""
    from datetime import date as _d, datetime as _dt

    from app.models.deposit_account import DepositAccount
    from app.models.investment_record import InvestmentRecord
    from app.models.message_log import MessageLog

    d = env["d"]
    async with env["Session"]() as db:
        for k in ("A", "B"):
            da = DepositAccount(profile_id=d[f"profile_{k}"], customer_id=d[f"client_{k}"], securities_company="테스트증권")
            db.add(da)
            await db.flush()
            d[f"deposit_{k}"] = da.id
            ir = InvestmentRecord(
                profile_id=d[f"profile_{k}"], record_type="investment", product_name=f"상품{k}",
                investment_amount=100, start_date=_d(2026, 1, 2), status="ing",
            )
            db.add(ir)
            await db.flush()
            d[f"record_{k}"] = ir.id
            ml = MessageLog(user_id=d[k], client_id=d[f"client_{k}"], message_type="sms", message_summary="테스트", message_text="안녕하세요", sent_at=_dt(2026, 9, 1))
            db.add(ml)
            await db.flush()
            d[f"msg_{k}"] = ml.id
        await db.commit()


async def test_05_deposit_accounts_scoped(env):
    await _seed_more(env)
    c, d, hdr = env["c"], env["d"], env["hdr"]
    h = hdr(d["A"])
    r = await c.get("/retirement/deposit-accounts", headers=h)
    assert r.status_code == 200, r.text
    ids = {x["id"] for x in r.json()}
    assert d["deposit_A"] in ids and d["deposit_B"] not in ids
    r = await c.get("/retirement/deposit-accounts", params={"customer_id": d["client_B"]}, headers=h)
    assert r.json() == []
    assert (await c.get(f"/retirement/deposit-accounts/{d['deposit_B']}/transactions", headers=h)).status_code == 404
    assert (await c.put(f"/retirement/deposit-accounts/{d['deposit_B']}", headers=h, json={"nickname": "x"})).status_code == 404
    assert (await c.delete(f"/retirement/deposit-accounts/{d['deposit_B']}", headers=h)).status_code == 404
    r = await c.post("/retirement/deposit-accounts", headers=h, json={"customer_id": d["client_B"], "securities_company": "x"})
    assert r.status_code == 404
    # 대표는 전체
    r = await c.get("/retirement/deposit-accounts", headers=hdr(d["owner"]))
    ids = {x["id"] for x in r.json()}
    assert {d["deposit_A"], d["deposit_B"]} <= ids


async def test_investment_records_scoped(env):
    await _seed_more(env)
    c, d, hdr = env["c"], env["d"], env["hdr"]
    h = hdr(d["A"])
    r = await c.get("/retirement/investment-records", headers=h)
    ids = {x["id"] for x in r.json()}
    assert d["record_A"] in ids and d["record_B"] not in ids
    r = await c.get("/retirement/investment-records", params={"customer_id": d["client_B"]}, headers=h)
    assert r.json() == []
    assert (await c.put(f"/retirement/investment-records/{d['record_B']}", headers=h, json={"memo": "x"})).status_code == 404
    assert (await c.delete(f"/retirement/investment-records/{d['record_B']}", headers=h)).status_code == 404
    assert (await c.get(f"/retirement/investment-records/annual-flow/{d['client_B']}/2026", headers=h)).status_code == 404
    # 자기 고객 흐름표에 남의 예수금 계좌를 끼워 넣어도 404
    r = await c.get(
        f"/retirement/investment-records/annual-flow/{d['client_A']}/2026",
        params={"deposit_account_id": d["deposit_B"]}, headers=h,
    )
    assert r.status_code == 404
    r = await c.post("/retirement/investment-records", headers=h, json={
        "profile_id": d["client_B"], "record_type": "investment", "investment_amount": 1, "start_date": "2026-01-01", "status": "ing",
    })
    assert r.status_code == 404, r.text
    # 자기 고객 기록에 남의 예수금 계좌 연결 시도 → 404
    r = await c.post("/retirement/investment-records", headers=h, json={
        "profile_id": d["client_A"], "record_type": "investment", "investment_amount": 1, "start_date": "2026-01-01",
        "status": "ing", "deposit_account_id": d["deposit_B"],
    })
    assert r.status_code == 404, r.text
    # 정상 경로: 자기 고객은 200
    r = await c.get(f"/retirement/investment-records/annual-flow/{d['client_A']}/2026", headers=h)
    assert r.status_code == 200, r.text


async def test_message_logs_by_client(env):
    await _seed_more(env)
    c, d, hdr = env["c"], env["d"], env["hdr"]
    r = await c.get("/message-logs", headers=hdr(d["A"]))
    assert r.status_code == 200, r.text
    ids = {x["id"] for x in r.json()["items"]}
    assert d["msg_A"] in ids and d["msg_B"] not in ids
    assert (await c.delete(f"/message-logs/{d['msg_B']}", headers=hdr(d["A"]))).status_code == 404
    r = await c.get("/message-logs", headers=hdr(d["owner"]))
    ids = {x["id"] for x in r.json()["items"]}
    assert {d["msg_A"], d["msg_B"]} <= ids


async def test_06_07_master_data(env):
    c, d, hdr = env["c"], env["d"], env["hdr"]
    h = hdr(d["A"])
    assert (await c.get("/product-master", headers=h)).status_code == 200
    r = await c.post("/product-master", headers=h, json={"product_name": "권한테스트상품"})
    assert r.status_code == 403
    assert (await c.put("/brand", headers=h, json={})).status_code == 403
    assert (await c.post("/retirement/wrap-accounts", headers=h, json={})).status_code in (403, 422)


async def test_messaging_other_client_404(env):
    c, d, hdr = env["c"], env["d"], env["hdr"]
    r = await c.post("/messaging/send-sms", headers=hdr(d["A"]), json={"client_id": d["client_B"], "message": "x"})
    assert r.status_code == 404, r.text


async def test_report_other_client_404(env):
    c, d, hdr = env["c"], env["d"], env["hdr"]
    r = await c.post("/reports/portfolio", headers=hdr(d["A"]), json={"client_id": d["client_B"], "account_ids": [], "snapshot_date": "2026-09-01"})
    assert r.status_code == 404, r.text
    # 자기 고객 + 남의 계좌 조합 → 404
    r = await c.post("/reports/portfolio", headers=hdr(d["A"]), json={"client_id": d["client_A"], "account_ids": [d["account_B"]], "snapshot_date": "2026-09-01"})
    assert r.status_code == 404, r.text


# ── 매니저 관리·대표 통합 현황 (P4, 결정 D-1·D-3) ─────────────────────


async def test_08_manager_cannot_use_admin_apis(env):
    c, d, hdr = env["c"], env["d"], env["hdr"]
    h = hdr(d["A"])
    assert (await c.get("/managers", headers=h)).status_code == 403
    assert (await c.post("/managers", headers=h, json={"email": "perm-x@x.com", "nickname": "x"})).status_code == 403
    assert (await c.get("/admin/overview", headers=h)).status_code == 403
    assert (await c.get(f"/managers/{d['B']}/summary", headers=h)).status_code == 403


async def test_public_register_closed(env):
    c = env["c"]
    r = await c.post("/auth/register", json={"email": "perm-reg@x.com", "password": "pw123456", "nickname": "x"})
    assert r.status_code == 403


async def test_owner_creates_manager_and_manager_logs_in(env):
    import uuid as _uuid

    c, d, hdr = env["c"], env["d"], env["hdr"]
    email = f"perm-{_uuid.uuid4().hex[:8]}@x.com"
    r = await c.post("/managers", headers=hdr(d["owner"]), json={"email": email, "nickname": "신규매니저"})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["role"] == "manager" and body["temp_password"]
    # 중복 이메일 409
    assert (await c.post("/managers", headers=hdr(d["owner"]), json={"email": email, "nickname": "y"})).status_code == 409
    # 임시 비밀번호로 로그인 → 담당 고객 0명
    r = await c.post("/auth/login/json", json={"email": email, "password": body["temp_password"]})
    assert r.status_code == 200, r.text
    tok = r.json()["access_token"]
    r = await c.get("/clients", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200 and r.json() == []
    # 비밀번호 재설정 → 옛 비밀번호로는 로그인 불가
    r = await c.post(f"/managers/{body['id']}/reset-password", headers=hdr(d["owner"]))
    assert r.status_code == 200
    assert (await c.post("/auth/login/json", json={"email": email, "password": body["temp_password"]})).status_code == 401
    # 담당 고객 없는 매니저는 비활성화 가능 → 로그인 차단
    r = await c.patch(f"/managers/{body['id']}", headers=hdr(d["owner"]), json={"is_active": False})
    assert r.status_code == 200 and r.json()["is_active"] is False and r.json()["deactivated_at"]


async def test_deactivate_manager_with_clients_is_409(env):
    c, d, hdr = env["c"], env["d"], env["hdr"]
    r = await c.patch(f"/managers/{d['A']}", headers=hdr(d["owner"]), json={"is_active": False})
    assert r.status_code == 409


async def test_owner_overview_and_summary(env):
    c, d, hdr = env["c"], env["d"], env["hdr"]
    r = await c.get("/admin/overview", headers=hdr(d["owner"]))
    assert r.status_code == 200, r.text
    ov = r.json()
    rows = {m["id"]: m for m in ov["by_manager"]}
    assert rows[d["A"]]["stats"]["clients"] == 1 and rows[d["A"]]["stats"]["accounts"] == 1
    r = await c.get(f"/managers/{d['A']}/summary", headers=hdr(d["owner"]))
    assert r.status_code == 200
    assert [x["id"] for x in r.json()["clients"]] == [d["client_A"]]
    r = await c.get("/managers", headers=hdr(d["owner"]))
    assert {d["A"], d["B"], d["owner"]} <= {m["id"] for m in r.json()}


async def test_client_response_has_manager(env):
    c, d, hdr = env["c"], env["d"], env["hdr"]
    r = await c.get("/clients", params={"manager_id": d["A"]}, headers=hdr(d["owner"]))
    row = next(x for x in r.json() if x["id"] == d["client_A"])
    # 고객용 보고서의 '담당 OOO · 연락처'에 쓰려고 연락처도 함께 내려준다 (P9)
    assert row["manager"] == {"id": d["A"], "nickname": "매니저A", "phone": None, "email": row["manager"]["email"]}
    assert row["manager"]["email"].startswith("perm-")


async def test_04_delete_other_managers_snapshot_is_404(env):
    """매니저A가 매니저B 고객 계좌의 스냅샷 삭제 → 404, 데이터 그대로 (지시서 14.1 #4)."""
    from datetime import date as _d

    from sqlalchemy import select

    from app.models.snapshot import PortfolioSnapshot

    c, d, hdr = env["c"], env["d"], env["hdr"]
    async with env["Session"]() as db:
        snap = PortfolioSnapshot(client_account_id=d["account_B"], snapshot_date=_d(2026, 9, 1))
        db.add(snap)
        await db.commit()
        sid = snap.id
    for method, path, body in [
        ("DELETE", f"/snapshots/{sid}", None),
        ("GET", f"/snapshots/{sid}", None),
        ("PATCH", f"/snapshots/{sid}", {}),
    ]:
        r = await c.request(method, path, headers=hdr(d["A"]), json=body)
        assert r.status_code == 404, (method, r.status_code, r.text)
    async with env["Session"]() as db:
        assert (await db.execute(select(PortfolioSnapshot).where(PortfolioSnapshot.id == sid))).scalar_one_or_none() is not None
    # 담당 매니저B·대표는 조회 가능
    assert (await c.get(f"/snapshots/{sid}", headers=hdr(d["B"]))).status_code == 200
    assert (await c.get(f"/snapshots/{sid}", headers=hdr(d["owner"]))).status_code == 200
