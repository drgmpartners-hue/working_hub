"""대행 로그인 테스트 (docs/login_logic P8-2, 지시서 14.2 #11~17).

실제 PostgreSQL 필요: PERM_PG_URL 지정 시 실행 (tests/test_permissions.py 와 같은 시드 사용).
"""
from datetime import timedelta

import pytest

from tests.test_permissions import PG, env  # noqa: F401 — 같은 시드 픽스처 재사용

pytestmark = pytest.mark.skipif(not PG, reason="PERM_PG_URL 없음(실제 PostgreSQL 필요)")


async def _start(c, hdr, d, target_key="A"):
    r = await c.post(f"/auth/impersonate/{d[target_key]}", headers=hdr(d["owner"]))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["impersonating"]["user_id"] == d[target_key]
    # 결정 D-4: 대행 시간제한 없음 — 일반 로그인과 같은 유효기간
    from app.core.security import ACCESS_TOKEN_EXPIRE_MINUTES
    assert body["expires_in"] == ACCESS_TOKEN_EXPIRE_MINUTES * 60
    return {"Authorization": f"Bearer {body['access_token']}"}


async def test_11_impersonated_owner_sees_manager_view(env):  # noqa: F811
    c, d, hdr = env["c"], env["d"], env["hdr"]
    h = await _start(c, hdr, d)
    ids_imp = {x["id"] for x in (await c.get("/clients", headers=h)).json()}
    ids_mgr = {x["id"] for x in (await c.get("/clients", headers=hdr(d["A"]))).json()}
    assert ids_imp == ids_mgr and d["client_B"] not in ids_imp
    # 대행 중에는 관리자 기능도 매니저처럼 막힌다
    assert (await c.get("/admin/overview", headers=h)).status_code == 403
    s = (await c.get("/auth/session", headers=h)).json()
    assert s["is_impersonating"] is True and s["actor"]["id"] == d["owner"] and s["effective"]["id"] == d["A"]
    assert s["impersonation_expires_at"].endswith("Z")


async def test_12_forbidden_actions_while_impersonating(env):  # noqa: F811
    c, d, hdr = env["c"], env["d"], env["hdr"]
    h = await _start(c, hdr, d)
    r = await c.post("/auth/password/change", headers=h, json={"current_password": "pw", "new_password": "x12345678"})
    assert r.status_code == 403
    assert (await c.patch("/users/me", headers=h, json={"nickname": "해킹"})).status_code == 403
    assert (await c.delete("/users/me", headers=h)).status_code == 403
    assert (await c.post("/user-api-keys", headers=h, json={"provider": "claude", "api_key": "sk-x"})).status_code == 403
    assert (await c.delete("/user-api-keys/claude", headers=h)).status_code == 403
    assert (await c.post("/managers", headers=h, json={"email": "perm-z@x.com", "nickname": "z"})).status_code == 403


async def test_13_nested_impersonation_is_400(env):  # noqa: F811
    c, d, hdr = env["c"], env["d"], env["hdr"]
    h = await _start(c, hdr, d)
    assert (await c.post(f"/auth/impersonate/{d['B']}", headers=h)).status_code == 400


async def test_14_manager_cannot_impersonate(env):  # noqa: F811
    c, d, hdr = env["c"], env["d"], env["hdr"]
    assert (await c.post(f"/auth/impersonate/{d['B']}", headers=hdr(d["A"]))).status_code == 403
    # 대표가 대표(자기 자신)로는 전환 불가
    assert (await c.post(f"/auth/impersonate/{d['owner']}", headers=hdr(d["owner"]))).status_code == 400


async def test_15_expired_token_is_401(env):  # noqa: F811
    from app.core.security import create_access_token

    c, d = env["c"], env["d"]
    tok = create_access_token(d["A"], expires_delta=timedelta(seconds=-1), extra_claims={"act": d["owner"], "imp": True})
    assert (await c.get("/clients", headers={"Authorization": f"Bearer {tok}"})).status_code == 401


async def test_forged_token_from_manager_is_401(env):  # noqa: F811
    """매니저가 act 를 붙인 토큰(대표가 아닌 actor)은 매 요청 재검증에서 거부."""
    from app.core.security import create_access_token

    c, d = env["c"], env["d"]
    tok = create_access_token(d["B"], extra_claims={"act": d["A"], "imp": True})
    assert (await c.get("/clients", headers={"Authorization": f"Bearer {tok}"})).status_code == 401


async def test_16_audit_log_records_actor_and_effective(env):  # noqa: F811
    from sqlalchemy import select

    from app.models.audit_log import AuditLog

    c, d, hdr = env["c"], env["d"], env["hdr"]
    await _start(c, hdr, d)
    async with env["Session"]() as db:
        row = (
            await db.execute(
                select(AuditLog)
                .where(AuditLog.action == "impersonate_start", AuditLog.effective_user_id == d["A"])
                .order_by(AuditLog.created_at.desc())
            )
        ).scalars().first()
    assert row is not None
    assert row.actor_user_id == d["owner"] and row.is_impersonated is True


async def test_17_exit_returns_owner_session(env):  # noqa: F811
    c, d, hdr = env["c"], env["d"], env["hdr"]
    h = await _start(c, hdr, d)
    r = await c.post("/auth/impersonate/exit", headers=h)
    assert r.status_code == 200
    h2 = {"Authorization": f"Bearer {r.json()['access_token']}"}
    s = (await c.get("/auth/session", headers=h2)).json()
    assert s["is_impersonating"] is False and s["actor"]["id"] == s["effective"]["id"] == d["owner"]
    # 대행 중이 아닐 때 exit → 400
    assert (await c.post("/auth/impersonate/exit", headers=h2)).status_code == 400


async def test_16b_impersonated_write_is_audited(env):  # noqa: F811
    """대행 중 고객 수정 → 감사 로그에 actor=대표, effective=매니저A, 대행 표시 (지시서 14.2 #16)."""
    c, d, hdr = env["c"], env["d"], env["hdr"]
    h = await _start(c, hdr, d)
    r = await c.put(f"/clients/{d['client_A']}", headers=h, json={"memo": "대행 수정"})
    assert r.status_code == 200, r.text
    r = await c.get("/admin/audit-logs", headers=hdr(d["owner"]), params={"client_id": d["client_A"], "impersonated": "true"})
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert items, "대행 수정 기록이 없음"
    top = items[0]
    assert top["actor_id"] == d["owner"] and top["effective_id"] == d["A"] and top["is_impersonated"] is True
    assert top["action"] == "update" and top["client_name"] == "고객A"


async def test_audit_logs_owner_only(env):  # noqa: F811
    """감사 로그는 대표만 (결정 D-5). 매니저는 본인 기록도 못 보고, 대행 중에도 403."""
    c, d, hdr = env["c"], env["d"], env["hdr"]
    # 매니저 본인 쓰기도 기록된다
    assert (await c.put(f"/clients/{d['client_A']}", headers=hdr(d["A"]), json={"memo": "본인 수정"})).status_code == 200
    r = await c.get("/admin/audit-logs", headers=hdr(d["owner"]), params={"user_id": d["A"], "impersonated": "false"})
    assert any(x["actor_id"] == d["A"] and x["client_id"] == d["client_A"] for x in r.json()["items"])
    assert (await c.get("/admin/audit-logs", headers=hdr(d["A"]))).status_code == 403
    h = await _start(c, hdr, d)
    assert (await c.get("/admin/audit-logs", headers=h)).status_code == 403


async def test_login_success_and_failure_audited(env):  # noqa: F811
    from sqlalchemy import select

    from app.models.audit_log import AuditLog
    from app.models.user import User

    c, d, hdr = env["c"], env["d"], env["hdr"]
    async with env["Session"]() as db:
        email = (await db.execute(select(User.email).where(User.id == d["A"]))).scalar_one()
    assert (await c.post("/auth/login/json", json={"email": email, "password": "wrong"})).status_code == 401
    assert (await c.post("/auth/login/json", json={"email": email, "password": "pw"})).status_code == 200
    r = (await c.get("/admin/audit-logs", headers=hdr(d["owner"]), params={"action": "login"})).json()
    assert any(x["actor_id"] == d["A"] for x in r["items"])
    async with env["Session"]() as db:
        failed = (await db.execute(select(AuditLog).where(AuditLog.action == "login_failed").order_by(AuditLog.created_at.desc()))).scalars().first()
    assert failed is not None and failed.payload_summary["email"] == email and "password" not in failed.payload_summary


async def test_client_history_owner_only(env):  # noqa: F811
    c, d, hdr = env["c"], env["d"], env["hdr"]
    assert (await c.get(f"/clients/{d['client_A']}/transfers", headers=hdr(d["A"]))).status_code == 403
    assert (await c.get(f"/clients/{d['client_A']}/transfers", headers=hdr(d["owner"]))).status_code == 200
