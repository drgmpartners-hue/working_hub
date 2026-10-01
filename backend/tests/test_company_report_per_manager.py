"""기업 리포트 담당자별 목록 (docs/login_logic P9, 2026-10-01 개편).

- 매니저는 빈 목록에서 시작, 자기가 추가한 기업만 본다. 같은 기업은 하나(추가한 계정만 늘어남).
- 대표는 전체 + 누가 추가했는지. 같은 계정이 다시 추가할 때만 '이미 추가한 기업'.
- 데일리·월간은 매니저 본인에게 자동 발송, 수신자 명단은 회사 명단 하나(대표·관리자).

실제 PostgreSQL 필요: PERM_PG_URL 지정 시 실행 (tests/test_permissions.py 와 같은 시드 사용).
"""
import uuid
from datetime import date

import pytest

from tests.test_permissions import PG, env  # noqa: F401 — 같은 시드 픽스처 재사용

pytestmark = pytest.mark.skipif(not PG, reason="PERM_PG_URL 없음(실제 PostgreSQL 필요)")

CR = "/company-report"


def _name(tag: str) -> str:
    return f"P9{tag}-{uuid.uuid4().hex[:6]}"


async def _create(c, h, name, view=None):
    headers = {**h, **({"X-View-As": view} if view else {})}
    return await c.post(f"{CR}/companies", headers=headers, json={"name": name, "backfill_months": 0})


async def _ids(c, h, view=None, **params):
    headers = {**h, **({"X-View-As": view} if view else {})}
    r = await c.get(f"{CR}/companies", headers=headers, params=params)
    assert r.status_code == 200, r.text
    return {x["id"]: x for x in r.json()}


async def _setup(env):  # noqa: F811
    c, d, hdr = env["c"], env["d"], env["hdr"]
    ho, ha, hb = hdr(d["owner"]), hdr(d["A"]), hdr(d["B"])
    r = await _create(c, ho, _name("대표"))
    assert r.status_code == 201, r.text
    own_o = r.json()
    assert own_o["can_edit"] and own_o["can_manage"] and [x["id"] for x in own_o["added_by"]] == [d["owner"]]
    r = await _create(c, ha, _name("A"))
    assert r.status_code == 201, r.text
    own_a = r.json()
    assert own_a["is_mine"] and own_a["can_edit"] and not own_a["can_manage"] and own_a["added_by"] == []
    return c, d, ho, ha, hb, own_o, own_a


async def test_manager_starts_empty_and_sees_only_own(env):  # noqa: F811
    c, d, ho, ha, hb, own_o, own_a = await _setup(env)
    a = await _ids(c, ha)
    b = await _ids(c, hb)
    assert set(a) == {own_a["id"]}                         # 대표 기업은 물려받지 않는다
    assert b == {}                                         # 새 매니저는 빈 목록
    o_all = await _ids(c, ho)                              # 대표 = 전체 + 추가한 사람
    assert {own_o["id"], own_a["id"]} <= set(o_all)
    assert [x["name"] for x in o_all[own_a["id"]]["added_by"]] == ["매니저A"]
    assert set(await _ids(c, ho, view="company")) >= {own_o["id"]} and own_a["id"] not in await _ids(c, ho, view="company")
    assert set(await _ids(c, ho, view=d["A"])) == {own_a["id"]}
    assert set(await _ids(c, ha, view=d["B"])) == set(a)  # 매니저가 헤더를 보내도 무시
    # 상세·하위 자료: 목록에 없는 기업은 404
    for path in ("", "/articles", "/facts"):
        assert (await c.get(f"{CR}/companies/{own_a['id']}{path}", headers=hb)).status_code == 404
        assert (await c.get(f"{CR}/companies/{own_o['id']}{path}", headers=ha)).status_code == 404
    assert (await c.get(f"{CR}/companies/{own_a['id']}", headers=ho)).status_code == 200
    # 숨기기 기능은 없어졌다
    assert (await c.post(f"{CR}/companies/{own_o['id']}/hide", headers=ha)).status_code in (404, 405)


async def test_add_same_company_rules(env):  # noqa: F811
    c, d, ho, ha, hb, own_o, own_a = await _setup(env)
    # B 가 A 의 기업을 추가 → 중복 알림 없이 B 목록에 들어온다(같은 기업 하나)
    r = await _create(c, hb, own_a["name"])
    assert r.status_code == 201 and r.json()["id"] == own_a["id"] and r.json()["added_by"] == [], r.text
    assert own_a["id"] in await _ids(c, hb)
    # 같은 계정이 다시 추가할 때만 안내
    r = await _create(c, hb, own_a["name"])
    assert r.status_code == 409 and "이미 추가한" in r.json()["detail"]
    r = await _create(c, ha, own_a["name"])
    assert r.status_code == 409
    # 대표 화면: 추가한 사람 둘
    o = await _ids(c, ho)
    assert [x["name"] for x in o[own_a["id"]]["added_by"]] == ["매니저A", "매니저B"]
    # 대표가 매니저 B 화면을 고른 채 추가하면 B 목록으로
    r = await _create(c, ho, own_o["name"], view=d["B"])
    assert r.status_code == 201 and r.json()["id"] == own_o["id"]
    assert own_o["id"] in await _ids(c, hb)
    r = await _create(c, ho, own_o["name"], view=d["B"])
    assert r.status_code == 409 and "매니저B" in r.json()["detail"]
    # 대표 본인도 같은 규칙
    r = await _create(c, ho, own_a["name"])
    assert r.status_code == 201
    assert (await _create(c, ho, own_a["name"])).status_code == 409


async def test_edit_and_remove_rules(env):  # noqa: F811
    c, d, ho, ha, hb, own_o, own_a = await _setup(env)
    await _create(c, hb, own_a["name"])
    # 추가한 사람은 정보·키워드를 고칠 수 있다, 목록에 없는 사람은 404
    assert (await c.put(f"{CR}/companies/{own_a['id']}", headers=hb, json={"memo": "B 메모"})).status_code == 200
    assert (await c.put(f"{CR}/companies/{own_o['id']}", headers=ha, json={"memo": "x"})).status_code == 404
    # 비활성·복구·완전 삭제는 대표만(모두에게 영향)
    assert (await c.put(f"{CR}/companies/{own_a['id']}", headers=ha, json={"is_active": False})).status_code == 403
    assert (await c.delete(f"{CR}/companies/{own_a['id']}", headers=ha)).status_code == 403
    # 매니저 [삭제] = 내 목록에서 빼기. 다른 사람이 남아 있으면 기업은 그대로
    r = await c.post(f"{CR}/companies/{own_a['id']}/trash", headers=ha)
    assert r.status_code == 200 and r.json()["removed_from_list"] is True
    assert own_a["id"] not in await _ids(c, ha)
    assert own_a["id"] in await _ids(c, hb)
    assert (await c.get(f"{CR}/companies/{own_a['id']}", headers=ho)).json()["deleted_at"] is None
    # 마지막 한 명이 빼면 화면에서 삭제 → 대표의 [삭제된 기업]에 보인다, 매니저는 삭제된 목록을 못 본다
    assert (await c.post(f"{CR}/companies/{own_a['id']}/trash", headers=hb)).status_code == 200
    assert own_a["id"] in await _ids(c, ho, deleted="true")
    assert await _ids(c, hb, deleted="true") == {}
    # 다시 추가하면 되살려서 추가한 사람 목록에만
    r = await _create(c, ha, own_a["name"])
    assert r.status_code == 201 and r.json()["id"] == own_a["id"] and r.json()["deleted_at"] is None
    assert own_a["id"] not in await _ids(c, hb)
    o = await _ids(c, ho)
    assert [x["name"] for x in o[own_a["id"]]["added_by"]] == ["매니저A"]


async def test_briefing_is_filtered_per_viewer(env):  # noqa: F811
    from app.models.news_briefing import NewsBriefing

    c, d, ho, ha, hb, own_o, own_a = await _setup(env)
    own_b = (await _create(c, hb, _name("Bown"))).json()
    await _create(c, hb, own_a["name"])  # B 도 A 기업을 추가
    day = date(2031, 1, 2 + int(uuid.uuid4().int % 25))
    cards = [
        {"company_id": own_o["id"], "name": own_o["name"], "article_count": 2, "caution_count": 1,
         "articles": [{"id": "a1", "title": "대표1"}, {"id": "a2", "title": "대표2"}]},
        {"company_id": own_a["id"], "name": own_a["name"], "article_count": 1, "caution_count": 0,
         "articles": [{"id": "a3", "title": "A1"}]},
        {"company_id": own_b["id"], "name": own_b["name"], "article_count": 4, "caution_count": 2,
         "articles": [{"id": "a4", "title": "B1"}]},
    ]
    overall = [{"text": "대표 기업 이야기", "source_ids": ["S1"]}, {"text": "B 이야기", "source_ids": ["S4"]},
               {"text": "시장 전반", "source_ids": []}]
    async with env["Session"]() as db:
        old = (await db.execute(__import__("sqlalchemy").select(NewsBriefing).where(NewsBriefing.briefing_date == day))).scalar_one_or_none()
        if old:
            await db.delete(old)
            await db.flush()
        db.add(NewsBriefing(briefing_date=day, status="approved", company_summaries=cards, article_count=7, caution_count=3,
                            basic_info={"company_with_news": 3}, overall_summary="",
                            review_summary={"overall": overall, "source_map": {"S1": "a1", "S3": "a3", "S4": "a4"}}))
        await db.commit()
    p = {"date": day.isoformat()}
    ra = (await c.get(f"{CR}/briefings/daily", headers=ha, params=p)).json()
    assert [x["company_id"] for x in ra["company_summaries"]] == [own_a["id"]]
    assert ra["article_count"] == 1 and ra["basic_info"]["company_with_news"] == 1
    assert "대표 기업 이야기" not in [x["text"] for x in ra["overall"]] and "B 이야기" not in [x["text"] for x in ra["overall"]]
    rb = (await c.get(f"{CR}/briefings/daily", headers=hb, params=p)).json()
    assert {x["company_id"] for x in rb["company_summaries"]} == {own_a["id"], own_b["id"]}
    assert "B 이야기" in [x["text"] for x in rb["overall"]]
    ro = (await c.get(f"{CR}/briefings/daily", headers=ho, params=p)).json()
    assert len(ro["company_summaries"]) == 3 and ro["article_count"] == 7        # 대표 전체
    lst = (await c.get(f"{CR}/briefings/daily/list", headers=ha, params={"limit": 120})).json()
    row = next(x for x in lst if x["briefing_date"] == day.isoformat())
    assert row["article_count"] == 1


async def test_manager_self_send_and_company_list(env, monkeypatch):  # noqa: F811
    from sqlalchemy import update

    from app.models.news_briefing import BriefingRecipient, NewsBriefing
    from app.models.user import User
    from app.services.company_report import mobile_link, sender

    c, d, ho, ha, hb, own_o, own_a = await _setup(env)
    # 매니저는 수신자 명단을 못 본다(본인 자동 발송)
    assert (await c.get(f"{CR}/recipients", headers=ha)).status_code == 403
    assert (await c.post(f"{CR}/recipients", headers=ha, json={"kind": "client", "ref_id": d["client_A"]})).status_code == 403
    me = (await c.get(f"{CR}/me", headers=ha)).json()["self_send"]
    assert me["company_count"] == 1 and me["has_phone"] is False
    async with env["Session"]() as db:
        await db.execute(update(User).where(User.id == d["A"]).values(phone="010-1212-3434"))
        await db.execute(update(User).where(User.id == d["B"]).values(phone="010-5656-7878"))
        await db.commit()
    me = (await c.get(f"{CR}/me", headers=ha)).json()["self_send"]
    assert me["has_phone"] and me["phone_masked"] == "010-****-3434"
    async with env["Session"]() as db:
        mine = {t.user_id: t for t in await sender.manager_self_targets(db) if t.user_id in (d["A"], d["B"])}
        assert set(mine) == {d["A"]}                    # B 는 목록이 비어 있어 안 보냄
        # 대표 발송 설정에 매니저 자동 발송 현황
    st = (await c.get(f"{CR}/settings", headers=ho)).json()
    assert any(x["name"] == "매니저A" and x["company_count"] == 1 for x in st["manager_self"]), st["manager_self"]
    # 사용 프로그램에서 기업 리포트를 빼면 보내지 않는다
    async with env["Session"]() as db:
        await db.execute(update(User).where(User.id == d["A"]).values(allowed_programs=["customers"]))
        await db.commit()
        assert all(t.user_id != d["A"] for t in await sender.manager_self_targets(db))
        await db.execute(update(User).where(User.id == d["A"]).values(allowed_programs=None))
        await db.commit()

    captured = []

    async def fake_send(db, msgs):
        captured.extend(msgs)
        return {"success": True, "groupId": "g"}

    monkeypatch.setattr("app.services.solapi_service.send_many_alimtalk", fake_send)
    day = date(2032, 3, 1 + int(uuid.uuid4().int % 27))
    cards = [{"company_id": own_a["id"], "name": "A카드", "article_count": 1, "caution_count": 0, "one_liner": "A 한줄",
              "articles": [{"id": "x1"}]},
             {"company_id": own_o["id"], "name": "대표카드", "article_count": 1, "caution_count": 0, "one_liner": "대표 한줄",
              "articles": [{"id": "x2"}]}]
    async with env["Session"]() as db:
        await db.execute(NewsBriefing.__table__.delete().where(NewsBriefing.briefing_date == day))  # 이전 실행 잔여
        await db.commit()
        b = NewsBriefing(briefing_date=day, status="approved", company_summaries=cards, article_count=2, caution_count=0,
                         basic_info={"company_with_news": 2},
                         review_summary={"overall": [{"text": "대표 기업 문장", "source_ids": ["S2"]}], "source_map": {"S2": "x2"}})
        db.add(b)
        await db.commit()
        targets = [t for t in await sender.recipients(db) if t.user_id == d["A"]]
        assert len(targets) == 1 and targets[0].kind == "self"
        await sender._deliver(db, b, targets, "test")
        # 폰 링크: 매니저 본인 링크는 자기 기업만
        ids = await mobile_link.subject_company_ids(db, f"u{d['A']}")
        assert ids == {own_a["id"]}
        # 같은 번호가 회사 명단에 있으면 한 번만(회사 명단 우선)
        r = BriefingRecipient(user_id=d["A"], name="매니저A", is_active=True)
        db.add(r)
        await db.commit()
        allt = [t for t in await sender.recipients(db) if t.user_id == d["A"]]
        assert len(allt) == 1 and allt[0].kind == "user"
        await db.delete(r)
        await db.commit()
    text = captured[0]["text"]
    assert captured[0]["to"] == "010-1212-3434"
    assert "A카드" in text and "대표카드" not in text and "대표 기업 문장" not in text, text


async def test_offboarding_moves_company_list(env):  # noqa: F811
    from app.models.user import User
    from app.services import transfer_service

    c, d, ho, ha, hb, own_o, own_a = await _setup(env)
    shared = (await _create(c, ha, _name("공유"))).json()
    await _create(c, hb, shared["name"])
    async with env["Session"]() as db:
        a = await db.get(User, d["A"])
        b = await db.get(User, d["B"])
        await transfer_service.transfer_all(db, a, b, d["owner"], "퇴사")
    b_ids = await _ids(c, hb)
    assert {own_a["id"], shared["id"]} <= set(b_ids)
    o = await _ids(c, ho)
    assert [x["name"] for x in o[shared["id"]]["added_by"]] == ["매니저B"]   # 중복 없이 하나


async def test_three_managers_remove_one_by_one(env):  # noqa: F811
    """대표님 예시(2026-10-01): A·B·C 모두 추가 → 대표 화면에 셋 다. A 가 빼면 B·C 만.
    B·C 까지 모두 빼야 목록에서 빠지고(폴더는 그대로), 폴더 완전 삭제는 대표가 따로."""
    from app.core.security import create_access_token, get_password_hash
    from app.models.user import User

    c, d, hdr = env["c"], env["d"], env["hdr"]
    ho, ha, hb = hdr(d["owner"]), hdr(d["A"]), hdr(d["B"])
    async with env["Session"]() as db:
        mc = User(email=f"perm-{uuid.uuid4().hex[:8]}@x.com", hashed_password=get_password_hash("pw"),
                  nickname="매니저C", is_active=True, role="manager")
        db.add(mc)
        await db.commit()
        cid_user = mc.id
    hc = {"Authorization": f"Bearer {create_access_token(cid_user)}"}
    name = _name("셋")
    first = (await _create(c, ha, name)).json()
    assert (await _create(c, hb, name)).json()["id"] == first["id"]
    assert (await _create(c, hc, name)).json()["id"] == first["id"]

    async def adders():
        return [x["name"] for x in (await _ids(c, ho))[first["id"]]["added_by"]]

    assert await adders() == ["매니저A", "매니저B", "매니저C"]
    # A 가 뺀다 → B·C 만 남는다
    assert (await c.post(f"{CR}/companies/{first['id']}/trash", headers=ha)).json()["removed_from_list"] is True
    assert await adders() == ["매니저B", "매니저C"]
    assert first["id"] not in await _ids(c, ha) and first["id"] in await _ids(c, hb)
    # B 가 뺀다 → C 만, 아직 목록에 있다
    await c.post(f"{CR}/companies/{first['id']}/trash", headers=hb)
    assert await adders() == ["매니저C"]
    assert first["id"] not in await _ids(c, ho, deleted="true")
    # C 까지 빼면 목록에서 빠지고 [삭제된 기업]으로 — 이유·마지막 사람 표시, 폴더 삭제 전
    await c.post(f"{CR}/companies/{first['id']}/trash", headers=hc)
    assert first["id"] not in await _ids(c, ho)
    gone = (await _ids(c, ho, deleted="true"))[first["id"]]
    assert gone["deleted_reason"] == "all_removed" and gone["deleted_by_name"] == "매니저C"
    s = (await c.get(f"{CR}/companies/{first['id']}/purge-summary", headers=ho)).json()
    assert s["trashed"] is True                      # 1단계(목록에서 빠짐)만, 폴더 완전 삭제는 대표가 [폴더까지 완전 삭제]로
    # 매니저는 완전 삭제 불가
    assert (await c.post(f"{CR}/companies/{first['id']}/purge", headers=hc, json={"confirm_name": name})).status_code in (403, 404)
    # 대표가 직접 삭제하면 이유가 다르게 남는다
    other = (await _create(c, ho, _name("대표삭제"))).json()
    assert (await c.post(f"{CR}/companies/{other['id']}/trash", headers=ho)).status_code == 200
    g2 = (await _ids(c, ho, deleted="true"))[other["id"]]
    assert g2["deleted_reason"] == "admin" and g2["deleted_by_name"] == "대표"
