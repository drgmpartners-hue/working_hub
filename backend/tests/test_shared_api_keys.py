"""회사 공용 키 / 본인 키 (2026-10-07) — 매니저는 대표 키를 함께 쓰고, Notion 만 각자. 키움 제거. 못 여는 값 실시간 표시."""
import pytest

from tests.test_permissions import PG, env  # noqa: F401  (앱 설정보다 먼저)


async def _clear(Session, uids):
    from sqlalchemy import delete

    from app.models.user_api_key import UserApiKey

    async with Session() as db:
        await db.execute(delete(UserApiKey).where(UserApiKey.user_id.in_(uids)))
        await db.commit()


@pytest.mark.skipif(not PG, reason="PERM_PG_URL 없음(실제 PostgreSQL 필요)")
async def test_manager_uses_company_key_notion_is_personal(env):  # noqa: F811
    from app.services.collectors.key_access import resolve_key
    from app.services.company_report.keys import get_service_key

    c, d, hdr, Session = env["c"], env["d"], env["hdr"], env["Session"]
    await _clear(Session, [d["owner"], d["A"], d["B"]])

    # 대표가 공용 키(claude)와 자기 Notion 을 등록
    assert (await c.post("/user-api-keys", headers=hdr(d["owner"]), json={"provider": "claude", "api_key": "sk-owner-claude"})).status_code == 201
    assert (await c.post("/user-api-keys", headers=hdr(d["owner"]), json={"provider": "notion", "api_key": "ntn_owner"})).status_code == 201

    # 매니저는 공용 키를 넣거나 지울 수 없다(403), Notion 은 자기 것을 넣는다
    r = await c.post("/user-api-keys", headers=hdr(d["A"]), json={"provider": "claude", "api_key": "sk-mgr"})
    assert r.status_code == 403
    assert (await c.delete("/user-api-keys/claude", headers=hdr(d["A"]))).status_code == 403
    assert (await c.post("/user-api-keys", headers=hdr(d["A"]), json={"provider": "notion", "api_key": "ntn_A"})).status_code == 201

    async with Session() as db:
        assert (await resolve_key(db, "claude", d["A"]))[0] == "sk-owner-claude"      # 매니저 → 대표 키
        assert (await get_service_key(db, "claude"))[0] == "sk-owner-claude"         # 배치 → 대표 키
        assert (await resolve_key(db, "notion", d["A"]))[0] == "ntn_A"               # Notion 은 본인 것
        assert await resolve_key(db, "notion", d["B"]) is None                        # 남의 Notion 은 안 씀
        assert await get_service_key(db, "notion") is None                            # 배치도 Notion 공용 없음
        assert await resolve_key(db, "dart", d["A"]) is None                          # 대표가 안 넣은 건 없음

    # 매니저 화면용 상태: 공용 claude 사용 가능, dart 미등록, notion 은 본인 등록 여부
    st = {x["provider"]: x for x in (await c.get("/user-api-keys/company", headers=hdr(d["A"]))).json()}
    assert st["claude"]["registered"] and not st["claude"]["personal"]
    assert not st["dart"]["registered"]
    assert st["notion"]["personal"] and st["notion"]["registered"]
    assert "kiwoom" not in st
    assert not {x["provider"]: x for x in (await c.get("/user-api-keys/company", headers=hdr(d["B"]))).json()}["notion"]["registered"]

    # 키움은 더 이상 받지 않음
    assert (await c.post("/user-api-keys", headers=hdr(d["owner"]), json={"provider": "kiwoom", "api_key": "x"})).status_code == 400
    await _clear(Session, [d["owner"], d["A"], d["B"]])


@pytest.mark.skipif(not PG, reason="PERM_PG_URL 없음(실제 PostgreSQL 필요)")
async def test_manager_own_key_never_becomes_company_key(env):  # noqa: F811
    """예전엔 공용 키가 없으면 아무 사용자의 활성 키를 썼다 — 매니저가 예전에 넣어 둔 키가 남에게 쓰이면 안 됨."""
    from app.core import encryption
    from app.models.user_api_key import UserApiKey
    from app.services.collectors.key_access import resolve_key

    d, Session = env["d"], env["Session"]
    await _clear(Session, [d["owner"], d["A"], d["B"]])
    async with Session() as db:
        db.add(UserApiKey(user_id=d["B"], provider="gemini", api_key=encryption.encrypt("AIza-manager-B")))
        await db.commit()
    async with Session() as db:
        assert await resolve_key(db, "gemini", d["A"]) is None
        assert await resolve_key(db, "gemini", None) is None
    await _clear(Session, [d["owner"], d["A"], d["B"]])


@pytest.mark.skipif(not PG, reason="PERM_PG_URL 없음(실제 PostgreSQL 필요)")
async def test_security_status_lists_unreadable_live(env):  # noqa: F811
    from sqlalchemy import update

    from app.models.user_api_key import UserApiKey

    c, d, hdr, Session = env["c"], env["d"], env["hdr"], env["Session"]
    await _clear(Session, [d["owner"], d["A"], d["B"]])
    assert (await c.post("/user-api-keys", headers=hdr(d["B"]), json={"provider": "notion", "api_key": "ntn_B"})).status_code == 201
    async with Session() as db:  # 예전 키로 잠겨 못 여는 값 흉내
        await db.execute(update(UserApiKey).where(UserApiKey.user_id == d["B"]).values(api_key="gAAAAA-broken-token"))
        await db.commit()
    items = (await c.get("/admin/security-status", headers=hdr(d["owner"]))).json()["unreadable_items"]
    mine = [x for x in items if x["kind"] == "api_key" and x["provider"] == "notion" and "매니저B" in x["message"]]
    assert mine and "gAAAAA" not in str(items)
    # 다시 등록하면 바로 사라진다
    assert (await c.post("/user-api-keys", headers=hdr(d["B"]), json={"provider": "notion", "api_key": "ntn_B2"})).status_code == 201
    items = (await c.get("/admin/security-status", headers=hdr(d["owner"]))).json()["unreadable_items"]
    assert not [x for x in items if "매니저B" in x["message"]]
    await _clear(Session, [d["owner"], d["A"], d["B"]])
