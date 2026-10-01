"""기업 리포트 담당자별 분리 (docs/login_logic P9, 결정 D-7).

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
    r = await c.post(f"{CR}/companies", headers=headers, json={"name": name, "backfill_months": 0})
    return r


async def _ids(c, h, view=None, **params):
    headers = {**h, **({"X-View-As": view} if view else {})}
    r = await c.get(f"{CR}/companies", headers=headers, params=params)
    assert r.status_code == 200, r.text
    return {x["id"]: x for x in r.json()}


async def _setup(env):  # noqa: F811
    c, d, hdr = env["c"], env["d"], env["hdr"]
    ho, ha, hb = hdr(d["owner"]), hdr(d["A"]), hdr(d["B"])
    r = await _create(c, ho, _name("공통"))
    assert r.status_code == 201, r.text
    common = r.json()
    assert common["scope"] == "common" and common["manager_user_id"] is None and common["can_edit"] is True
    r = await _create(c, ha, _name("A"))
    assert r.status_code == 201, r.text
    own_a = r.json()
    assert own_a["scope"] == "manager" and own_a["manager_user_id"] == d["A"] and own_a["manager_name"] == "매니저A"
    return c, d, ho, ha, hb, common, own_a


async def test_visibility_by_role_and_view(env):  # noqa: F811
    c, d, ho, ha, hb, common, own_a = await _setup(env)
    a = await _ids(c, ha)
    b = await _ids(c, hb)
    assert common["id"] in a and own_a["id"] in a
    assert common["id"] in b and own_a["id"] not in b          # 다른 매니저 기업은 안 보임
    assert a[common["id"]]["can_edit"] is False and a[own_a["id"]]["can_edit"] is True
    o_all = await _ids(c, ho)                                   # 대표 기본 = 전체
    assert {common["id"], own_a["id"]} <= set(o_all)
    o_company = await _ids(c, ho, view="company")
    assert common["id"] in o_company and own_a["id"] not in o_company
    o_a = await _ids(c, ho, view=d["A"])                        # 대표가 매니저A 화면 그대로
    assert {common["id"], own_a["id"]} <= set(o_a)
    o_b = await _ids(c, ho, view=d["B"])
    assert own_a["id"] not in o_b
    # 매니저가 헤더를 보내도 무시된다
    a2 = await _ids(c, ha, view=d["B"])
    assert set(a2) == set(a)
    # 상세·하위 자료: 다른 매니저 기업은 404
    assert (await c.get(f"{CR}/companies/{own_a['id']}", headers=hb)).status_code == 404
    assert (await c.get(f"{CR}/companies/{own_a['id']}/articles", headers=hb)).status_code == 404
    assert (await c.get(f"{CR}/companies/{own_a['id']}/facts", headers=hb)).status_code == 404
    assert (await c.get(f"{CR}/companies/{own_a['id']}", headers=ho)).status_code == 200


async def test_manager_can_only_hide_common(env):  # noqa: F811
    c, d, ho, ha, hb, common, own_a = await _setup(env)
    # 공통 기업 고치기·삭제·수집은 대표만
    assert (await c.put(f"{CR}/companies/{common['id']}", headers=ha, json={"memo": "x"})).status_code == 403
    assert (await c.post(f"{CR}/companies/{common['id']}/trash", headers=ha)).status_code == 403
    assert (await c.post(f"{CR}/companies/{common['id']}/facts", headers=ha,
                         json={"title": "t", "fact_type": "other"})).status_code == 403
    # 자기 기업은 고칠 수 있다, 담당 바꾸기는 대표만
    assert (await c.put(f"{CR}/companies/{own_a['id']}", headers=ha, json={"memo": "내 메모"})).status_code == 200
    assert (await c.put(f"{CR}/companies/{own_a['id']}", headers=ha, json={"manager_user_id": None})).status_code == 403
    # 숨기기 → A 목록에서 빠지고 숨김 목록에 보임, B 는 그대로
    assert (await c.post(f"{CR}/companies/{common['id']}/hide", headers=ha)).status_code == 200
    assert common["id"] not in await _ids(c, ha)
    hidden = await _ids(c, ha, hidden="true")
    assert common["id"] in hidden and hidden[common["id"]]["is_hidden"] is True
    assert common["id"] in await _ids(c, hb)
    assert common["id"] not in await _ids(c, ho, view=d["A"])   # 대표가 A 화면을 보면 숨김 반영
    # 숨겨도 직접 열면 볼 수 있다
    assert (await c.get(f"{CR}/companies/{common['id']}", headers=ha)).status_code == 200
    # 자기 기업은 숨기기 대상이 아님
    assert (await c.post(f"{CR}/companies/{own_a['id']}/hide", headers=ha)).status_code == 400
    # 대표 '전체' 화면에서는 숨기기 없음
    assert (await c.post(f"{CR}/companies/{common['id']}/hide", headers=ho)).status_code == 400
    # 숨긴 공통 기업을 다시 등록하면 → 숨김 해제
    r = await _create(c, ha, common["name"])
    assert r.status_code == 201 and r.json()["id"] == common["id"], r.text
    assert common["id"] in await _ids(c, ha)
    assert (await c.post(f"{CR}/companies/{common['id']}/hide", headers=ha)).status_code == 200
    assert (await c.post(f"{CR}/companies/{common['id']}/unhide", headers=ha)).status_code == 200
    assert common["id"] in await _ids(c, ha)


async def test_duplicate_rules(env):  # noqa: F811
    c, d, ho, ha, hb, common, own_a = await _setup(env)
    r = await _create(c, hb, own_a["name"])
    assert r.status_code == 409 and "매니저A" in r.json()["detail"], r.text      # 두 번 수집 방지
    r = await _create(c, ha, own_a["name"])
    assert r.status_code == 409 and "이미 등록된" in r.json()["detail"]
    r = await _create(c, ha, common["name"])
    assert r.status_code == 409 and "회사 공통" in r.json()["detail"]
    # 대표가 같은 기업을 등록하면 회사 공통으로 전환 → B 에게도 보인다
    r = await _create(c, ho, own_a["name"])
    assert r.status_code == 201 and r.json()["id"] == own_a["id"] and r.json()["scope"] == "common", r.text
    assert own_a["id"] in await _ids(c, hb)
    # 대표가 매니저 화면을 고른 채 등록하면 그 매니저 기업
    r = await _create(c, ho, _name("B"), view=d["B"])
    assert r.status_code == 201 and r.json()["manager_user_id"] == d["B"]
    # 대표는 담당을 바꿀 수 있다
    cid = r.json()["id"]
    r = await c.put(f"{CR}/companies/{cid}", headers=ho, json={"manager_user_id": None})
    assert r.status_code == 200 and r.json()["scope"] == "common"
    assert (await c.put(f"{CR}/companies/{cid}", headers=ho, json={"manager_user_id": d["owner"]})).status_code == 422


async def test_briefing_is_filtered_per_viewer(env):  # noqa: F811
    from app.models.news_briefing import NewsBriefing

    c, d, ho, ha, hb, common, own_a = await _setup(env)
    r = await _create(c, hb, _name("Bown"))
    own_b = r.json()
    day = date(2031, 1, 2 + int(uuid.uuid4().int % 25))
    cards = [
        {"company_id": common["id"], "name": common["name"], "article_count": 2, "caution_count": 1,
         "articles": [{"id": "a1", "title": "공통1"}, {"id": "a2", "title": "공통2"}]},
        {"company_id": own_a["id"], "name": own_a["name"], "article_count": 1, "caution_count": 0,
         "articles": [{"id": "a3", "title": "A1"}]},
        {"company_id": own_b["id"], "name": own_b["name"], "article_count": 4, "caution_count": 2,
         "articles": [{"id": "a4", "title": "B1"}]},
    ]
    overall = [{"text": "공통 이야기", "source_ids": ["S1"]}, {"text": "B 이야기", "source_ids": ["S4"]},
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
    assert {x["company_id"] for x in ra["company_summaries"]} == {common["id"], own_a["id"]}
    assert ra["article_count"] == 3 and ra["caution_count"] == 1 and ra["basic_info"]["company_with_news"] == 2
    assert [x["text"] for x in ra["overall"]] == ["공통 이야기", "시장 전반"]     # B 기업 문장은 빠짐
    rb = (await c.get(f"{CR}/briefings/daily", headers=hb, params=p)).json()
    assert {x["company_id"] for x in rb["company_summaries"]} == {common["id"], own_b["id"]}
    ro = (await c.get(f"{CR}/briefings/daily", headers=ho, params=p)).json()
    assert len(ro["company_summaries"]) == 3 and ro["article_count"] == 7        # 대표 전체
    # A 가 공통 기업을 숨기면 브리핑에서도 빠진다
    await c.post(f"{CR}/companies/{common['id']}/hide", headers=ha)
    ra = (await c.get(f"{CR}/briefings/daily", headers=ha, params=p)).json()
    assert [x["company_id"] for x in ra["company_summaries"]] == [own_a["id"]]
    assert ra["overall"][-1]["text"] == "시장 전반" or "담당 기업" in ra["overall"][0]["text"]
    lst = (await c.get(f"{CR}/briefings/daily/list", headers=ha, params={"limit": 120})).json()
    row = next(x for x in lst if x["briefing_date"] == day.isoformat())
    assert row["article_count"] == 1


async def test_recipient_lists_per_manager_and_send_filter(env, monkeypatch):  # noqa: F811
    from sqlalchemy import update

    from app.models.client import Client
    from app.models.news_briefing import BriefingRecipient, NewsBriefing
    from app.services.company_report import mobile_link, sender

    c, d, ho, ha, hb, common, own_a = await _setup(env)
    async with env["Session"]() as db:
        await db.execute(update(Client).where(Client.id.in_([d["client_A"], d["client_B"]])).values(phone="010-7777-8888"))
        await db.commit()
    # A 는 자기 명단에 자기 고객만
    assert (await c.post(f"{CR}/recipients", headers=ha, json={"kind": "client", "ref_id": d["client_B"]})).status_code == 404
    assert (await c.post(f"{CR}/recipients", headers=ha, json={"kind": "client", "ref_id": d["client_A"]})).status_code == 201
    sel_a = (await c.get(f"{CR}/recipients", headers=ha)).json()["selected"]
    assert [x["ref_id"] for x in sel_a] == [d["client_A"]]
    assert (await c.get(f"{CR}/recipients", headers=hb)).json()["selected"] == []
    rid = sel_a[0]["id"]
    assert (await c.delete(f"{CR}/recipients/{rid}", headers=hb)).status_code == 404   # 남의 명단
    # 대표: 전체 화면 = 회사 명단(비어 있음), 매니저A 를 고르면 A 명단
    assert all(x["ref_id"] != d["client_A"] for x in (await c.get(f"{CR}/recipients", headers=ho)).json()["selected"])
    sel_oa = (await c.get(f"{CR}/recipients", headers={**ho, "X-View-As": d["A"]})).json()["selected"]
    assert [x["id"] for x in sel_oa] == [rid]
    # 대표가 A 명단에 B 고객을 넣으려 하면 거절
    r = await c.post(f"{CR}/recipients", headers={**ho, "X-View-As": d["A"]}, json={"kind": "client", "ref_id": d["client_B"]})
    assert r.status_code == 422
    # 폰 링크: A 명단 수신자에게는 A 화면 기업만
    async with env["Session"]() as db:
        ids = await mobile_link.subject_company_ids(db, rid)
        assert own_a["id"] in ids and common["id"] in ids
        tg = await sender.recipient_targets(db, list_owner=d["A"])
        assert [t.recipient_id for t in tg] == [rid] and tg[0].list_owner == d["A"]
    # 발송: 수신자마다 자기 명단 주인의 카드만 들어간다
    captured = []

    async def fake_send(db, msgs):
        captured.extend(msgs)
        return {"success": True, "groupId": "g"}

    monkeypatch.setattr("app.services.solapi_service.send_many_alimtalk", fake_send)
    day = date(2032, 3, 1 + int(uuid.uuid4().int % 27))
    cards = [{"company_id": common["id"], "name": "공통카드", "article_count": 1, "caution_count": 0, "one_liner": "공통 한줄",
              "articles": [{"id": "x1"}]},
             {"company_id": str(uuid.uuid4()), "name": "남의카드", "article_count": 1, "caution_count": 0, "one_liner": "남 한줄",
              "articles": [{"id": "x2"}]}]
    async with env["Session"]() as db:
        b = NewsBriefing(briefing_date=day, status="approved", company_summaries=cards, article_count=2, caution_count=0,
                         basic_info={"company_with_news": 2},
                         review_summary={"overall": [{"text": "남 기업 문장", "source_ids": ["S2"]}], "source_map": {"S2": "x2"}})
        db.add(b)
        await db.commit()
        await sender._deliver(db, b, await sender.recipient_targets(db, list_owner=d["A"]), "test")
        await db.rollback()
    text = captured[0]["text"]
    assert "공통카드" in text and "남의카드" not in text and "남 기업 문장" not in text, text
    async with env["Session"]() as db:
        await db.execute(BriefingRecipient.__table__.delete().where(BriefingRecipient.id == rid))
        await db.commit()


async def test_offboarding_moves_companies_and_recipients(env):  # noqa: F811
    from sqlalchemy import select

    from app.models.news_briefing import BriefingRecipient, PortfolioCompany
    from app.models.user import User
    from app.services import transfer_service

    c, d, ho, ha, hb, common, own_a = await _setup(env)
    assert (await c.post(f"{CR}/recipients", headers=ha, json={"kind": "user", "ref_id": d["A"]})).status_code in (201, 422)
    async with env["Session"]() as db:
        a = await db.get(User, d["A"])
        b = await db.get(User, d["B"])
        await transfer_service.transfer_all(db, a, b, d["owner"], "퇴사")
        moved = await db.get(PortfolioCompany, own_a["id"])
        assert moved.manager_user_id == d["B"]
        left = (await db.execute(select(BriefingRecipient).where(BriefingRecipient.manager_user_id == d["A"]))).scalars().all()
        assert left == []
    assert own_a["id"] in await _ids(c, hb)
