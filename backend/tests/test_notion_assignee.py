"""고객 추가 > 노션: 담당자(main) 거르기 (2026-10-01).

- 담당자를 정하지 않으면 못 읽는다(422)
- 매니저는 본인 이름만(다른 이름 403)
- 노션 '담당자(main)' 값이 정확히 그 이름인 고객만, 비어 있으면 제외
"""
from types import SimpleNamespace

import httpx
import pytest
from fastapi import HTTPException

from app.api.v1 import notion

SCHEMA = {"properties": {
    "고객명": {"id": "t", "type": "title"},
    "담당자(main)": {"id": "m", "type": "select"},
}}


def _page(pid, name, mgr):
    props = {"고객명": {"type": "title", "title": [{"plain_text": name}]},
             "담당자(main)": {"type": "select", "select": {"name": mgr} if mgr else None}}
    return {"id": pid, "properties": props}


PAGES = [_page("1", "홍길동", "백서연"), _page("2", "김철수", "이영희"), _page("3", "박민수", None),
         _page("4", "최지우", "백 서연")]


@pytest.fixture
def fake_notion(monkeypatch):
    sent = {}

    async def token(uid, db):
        return "tok"

    async def req(method, url, tok, body=None, client=None):
        if method == "GET":
            return httpx.Response(200, json=SCHEMA)
        sent["filter"] = (body or {}).get("filter")
        # 서버 필터가 있어도 일부러 전부 돌려준다 → 서버 쪽 재확인이 거르는지 본다
        return httpx.Response(200, json={"results": PAGES, "has_more": False})

    monkeypatch.setattr(notion, "_get_notion_token", token)
    monkeypatch.setattr(notion, "_notion_request", req)
    return sent


OWNER = SimpleNamespace(id="o", role="owner", nickname="Dr.GM")
MGR = SimpleNamespace(id="m", role="manager", nickname="백서연")


async def _rows(user, **kw):
    return await notion.query_database("db1", current_user=user, db=None, **kw)


async def test_without_assignee_mode_unchanged(fake_notion):
    rows = await _rows(OWNER)
    assert len(rows) == 4 and fake_notion["filter"] is None


async def test_assignee_required(fake_notion):
    with pytest.raises(HTTPException) as e:
        await _rows(OWNER, assignee_property="담당자(main)", assignee="  ")
    assert e.value.status_code == 422 and "담당자를 먼저" in e.value.detail


async def test_owner_picks_manager(fake_notion):
    rows = await _rows(OWNER, assignee_property="담당자(main)", assignee="백서연")
    assert [r.properties["고객명"] for r in rows] == ["홍길동", "최지우"]   # 띄어쓰기만 다른 것은 같은 이름
    assert fake_notion["filter"] == {"property": "담당자(main)", "select": {"equals": "백서연"}}


async def test_manager_only_own_name(fake_notion):
    rows = await _rows(MGR, assignee_property="담당자(main)", assignee="백서연")
    assert {r.id for r in rows} == {"1", "4"}
    with pytest.raises(HTTPException) as e:
        await _rows(MGR, assignee_property="담당자(main)", assignee="이영희")
    assert e.value.status_code == 403


async def test_missing_column(fake_notion):
    with pytest.raises(HTTPException) as e:
        await _rows(OWNER, assignee_property="담당자", assignee="백서연")
    assert e.value.status_code == 422 and "칸이 없어" in e.value.detail


async def test_name_not_found_returns_empty(fake_notion):
    assert await _rows(OWNER, assignee_property="담당자(main)", assignee="Dr.GM") == []


def test_assignee_matches_multi():
    assert notion._assignee_matches("이영희, 백서연", "백서연")
    assert not notion._assignee_matches("백서연A", "백서연")
    assert not notion._assignee_matches(None, "백서연")
