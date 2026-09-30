"""담당자 이관 테스트 (docs/login_logic P8-3, 지시서 14.3 #18~25).

실제 PostgreSQL 필요: PERM_PG_URL 지정 시 실행 (tests/test_permissions.py 시드 재사용).
"""
from datetime import datetime

import pytest

from tests.test_permissions import PG, env  # noqa: F401

pytestmark = pytest.mark.skipif(not PG, reason="PERM_PG_URL 없음(실제 PostgreSQL 필요)")


async def _add_message_and_plan(env):
    """A 고객에 과거 문자 이력(발송자=A)과 은퇴 플랜을 만든다."""
    from app.models.message_log import MessageLog
    from app.models.retirement_plan import RetirementPlan

    d = env["d"]
    async with env["Session"]() as db:
        ml = MessageLog(user_id=d["A"], client_id=d["client_A"], message_type="sms",
                        message_summary="이관 전 문자", message_text="안녕하세요", sent_at=datetime(2026, 9, 1))
        rp = RetirementPlan(profile_id=d["profile_A"], current_age=45, annual_return_rate=5)
        db.add_all([ml, rp])
        await db.commit()
        d["msg_A"], d["plan_A"] = ml.id, rp.id


async def test_18_to_21_transfer_moves_everything(env):  # noqa: F811
    c, d, hdr = env["c"], env["d"], env["hdr"]
    await _add_message_and_plan(env)
    r = await c.post(f"/clients/{d['client_A']}/transfer", headers=hdr(d["owner"]),
                     json={"to_user_id": d["B"], "reason": "담당 변경"})
    assert r.status_code == 200, r.text
    # 18: 이력 1건
    hist = (await c.get(f"/clients/{d['client_A']}/transfers", headers=hdr(d["owner"]))).json()
    assert len(hist) == 1 and hist[0]["from_user_id"] == d["A"] and hist[0]["to_user_id"] == d["B"]
    assert hist[0]["reason"] == "담당 변경"
    # 19: 새 담당자가 은퇴 플랜 조회
    plans = (await c.get(f"/retirement/plans/{d['profile_A']}", headers=hdr(d["B"]))).json()
    assert any(p["id"] == d["plan_A"] for p in plans)
    # 20: 새 담당자가 과거 문자 이력 조회 (client_id 기준 판정)
    logs = (await c.get("/message-logs", headers=hdr(d["B"]), params={"client_id": d["client_A"]})).json()["items"]
    assert any(x["id"] == d["msg_A"] for x in logs)
    # 21: 원래 담당자는 404
    assert (await c.get(f"/clients/{d['client_A']}", headers=hdr(d["A"]))).status_code == 404
    # 감사 로그에 '이관'
    al = (await c.get("/admin/audit-logs", headers=hdr(d["owner"]), params={"client_id": d["client_A"], "action": "transfer"})).json()
    assert al["total"] >= 1


async def test_transfer_guards(env):  # noqa: F811
    c, d, hdr = env["c"], env["d"], env["hdr"]
    # 매니저는 이관 불가 (403)
    assert (await c.post(f"/clients/{d['client_A']}/transfer", headers=hdr(d["A"]), json={"to_user_id": d["B"]})).status_code == 403
    # 대행 중 불가 (403)
    tok = (await c.post(f"/auth/impersonate/{d['A']}", headers=hdr(d["owner"]))).json()["access_token"]
    h = {"Authorization": f"Bearer {tok}"}
    assert (await c.post(f"/clients/{d['client_A']}/transfer", headers=h, json={"to_user_id": d["B"]})).status_code == 403
    # 없는 계정·같은 담당자
    assert (await c.post(f"/clients/{d['client_A']}/transfer", headers=hdr(d["owner"]), json={"to_user_id": "nope"})).status_code == 404
    assert (await c.post(f"/clients/{d['client_A']}/transfer", headers=hdr(d["owner"]), json={"to_user_id": d["A"]})).status_code == 400


async def test_22_offboarding_flow(env):  # noqa: F811
    """퇴사 절차: 고객 남아 있으면 비활성화 409 → 일괄 이관 → 비활성화 성공 → 비활성 계정으로는 이관 불가."""
    c, d, hdr = env["c"], env["d"], env["hdr"]
    H = hdr(d["owner"])
    assert (await c.patch(f"/managers/{d['A']}", headers=H, json={"is_active": False})).status_code == 409
    r = await c.post(f"/managers/{d['A']}/transfer-all", headers=H, json={"to_user_id": d["B"], "reason": "퇴사"})
    assert r.status_code == 200 and r.json()["moved"] == 1
    r = await c.patch(f"/managers/{d['A']}", headers=H, json={"is_active": False})
    assert r.status_code == 200, r.text
    ids_b = {x["id"] for x in (await c.get("/clients", headers=hdr(d["B"]))).json()}
    assert d["client_A"] in ids_b
    # 비활성 계정(A)으로는 이관 불가
    assert (await c.post(f"/clients/{d['client_B']}/transfer", headers=H, json={"to_user_id": d["A"]})).status_code == 400


async def test_23_portal_after_transfer(env):  # noqa: F811
    """이관 후에도 고객 포털 토큰으로 접속 가능 (포털은 담당자와 무관)."""
    from sqlalchemy import select

    from app.models.client import Client

    c, d, hdr = env["c"], env["d"], env["hdr"]
    async with env["Session"]() as db:
        token = (await db.execute(select(Client.portal_token).where(Client.id == d["client_A"]))).scalar_one()
    before = await c.get(f"/client-portal/{token}")
    assert (await c.post(f"/clients/{d['client_A']}/transfer", headers=hdr(d["owner"]), json={"to_user_id": d["B"]})).status_code == 200
    after = await c.get(f"/client-portal/{token}")
    assert before.status_code == after.status_code and after.status_code < 500


async def test_24_owner_regression(env):  # noqa: F811
    """대표 단독 사용 흐름 무회귀: 고객 등록·수정·계좌 추가·삭제."""
    c, d, hdr = env["c"], env["d"], env["hdr"]
    H = hdr(d["owner"])
    r = await c.post("/clients", headers=H, json={"name": "대표신규고객"})
    assert r.status_code == 201, r.text
    cid = r.json()["id"]
    assert r.json()["manager"]["id"] == d["owner"]
    assert (await c.put(f"/clients/{cid}", headers=H, json={"memo": "메모"})).status_code == 200
    assert (await c.post(f"/clients/{cid}/accounts", headers=H, json={"account_type": "irp"})).status_code == 201
    assert (await c.delete(f"/clients/{cid}", headers=H)).status_code == 204


async def test_25_owner_cannot_read_others_api_keys(env):  # noqa: F811
    """대표라도 매니저의 API 키는 볼 수 없다 (목록은 본인 것만, 마스킹)."""
    from app.core.security import encrypt_api_key
    from app.models.user_api_key import UserApiKey

    c, d, hdr = env["c"], env["d"], env["hdr"]
    async with env["Session"]() as db:
        db.add(UserApiKey(user_id=d["A"], provider="claude", api_key=encrypt_api_key("sk-secret-manager-key")))
        await db.commit()
    r = await c.get("/user-api-keys", headers=hdr(d["owner"]))
    assert r.status_code == 200
    assert "sk-secret-manager-key" not in r.text
    # 대표 목록에 매니저 키가 섞이지 않는다 (대표는 키를 등록하지 않았으므로 claude 키가 없어야 함)
    body = r.json()
    items = body if isinstance(body, list) else body.get("items", [])
    assert not any(k.get("provider") == "claude" for k in items)
