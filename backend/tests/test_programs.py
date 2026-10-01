"""매니저별 사용 프로그램 (docs/login_logic P11).

실제 PostgreSQL 필요: PERM_PG_URL 지정 시 실행 (tests/test_permissions.py 와 같은 시드 사용).
"""
import pytest

from app.core import programs
from tests.test_permissions import PG, env  # noqa: F401

pytestmark_pg = pytest.mark.skipif(not PG, reason="PERM_PG_URL 없음(실제 PostgreSQL 필요)")


def test_path_rules():
    p = programs.programs_for_path
    assert p("/api/v1/company-report/companies") == {"company_report"}
    assert p("/api/v1/retirement/profiles/x") == {"retirement"}
    assert p("/api/v1/retirement/wrap-accounts") is None          # 공용
    assert p("/api/v1/retirement/wrap-accounts/options") is None
    assert p("/api/v1/portfolios/1") == {"portfolio"}
    assert p("/api/v1/clients") is None                             # 공용
    assert p("/api/v1/commissions/x") is None  # 수당정산 삭제(2026-10-01)
    assert p("/api/v1/stocks/x") is None
    assert p("/api/v1/company-reportx") is None


class _U:
    def __init__(self, role, progs):
        self.role, self.allowed_programs = role, progs


def test_allowed_and_check():
    assert programs.allowed_set(_U("owner", ["company_report"])) is None     # 대표는 전부
    assert programs.allowed_set(_U("manager", None)) is None                  # 기존 계정 = 전부
    # 삭제된 프로그램 키가 저장돼 있어도 무시
    assert programs.effective_list(_U("manager", ["stock_recommend", "company_report"])) == ["company_report"]
    assert programs.effective_list(_U("manager", ["company_report"])) == ["company_report"]
    programs.check_path(_U("manager", ["company_report"]), "/api/v1/company-report/companies")
    programs.check_path(_U("manager", ["company_report"]), "/api/v1/clients")
    with pytest.raises(Exception) as e:
        programs.check_path(_U("manager", ["company_report"]), "/api/v1/retirement/profiles")
    assert getattr(e.value, "status_code", None) == 403
    with pytest.raises(Exception):
        programs.normalize(["nope"])
    assert programs.normalize(["retirement", "customers"]) == ["customers", "retirement"]


@pytestmark_pg
async def test_owner_sets_programs_and_server_enforces(env):  # noqa: F811
    c, d, hdr = env["c"], env["d"], env["hdr"]
    ho, ha = hdr(d["owner"]), hdr(d["A"])
    assert (await c.get("/managers/programs", headers=ha)).status_code == 403
    keys = [p["key"] for p in (await c.get("/managers/programs", headers=ho)).json()]
    assert "company_report" in keys and "retirement" in keys
    # 기본(NULL) = 전부
    me = (await c.get("/users/me", headers=ha)).json()
    assert set(me["programs"]) == set(keys)
    # 매니저A: 기업 리포트만
    r = await c.patch(f"/managers/{d['A']}", headers=ho, json={"allowed_programs": ["company_report"]})
    assert r.status_code == 200 and r.json()["allowed_programs"] == ["company_report"], r.text
    assert (await c.get("/users/me", headers=ha)).json()["programs"] == ["company_report"]
    assert (await c.get("/company-report/companies", headers=ha)).status_code == 200
    r = await c.get(f"/retirement/profiles/{d['client_A']}", headers=ha)
    assert r.status_code == 403 and "은퇴플랜" in r.json()["detail"]
    assert (await c.get("/clients", headers=ha)).status_code == 200            # 공용 API 는 열림
    # 대행 중에도 매니저A 권한을 따른다
    r = await c.post(f"/auth/impersonate/{d['A']}", headers=ho)
    hi = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert (await c.get(f"/retirement/profiles/{d['client_A']}", headers=hi)).status_code == 403
    # 대표는 언제나 전부
    assert (await c.get(f"/retirement/profiles/{d['client_A']}", headers=ho)).status_code in (200, 404)
    # 대표 계정은 바꿀 수 없음, 알 수 없는 키 422
    assert (await c.patch(f"/managers/{d['owner']}", headers=ho, json={"allowed_programs": []})).status_code == 400
    assert (await c.patch(f"/managers/{d['A']}", headers=ho, json={"allowed_programs": ["nope"]})).status_code == 422
    # 다시 전부 허용
    assert (await c.patch(f"/managers/{d['A']}", headers=ho, json={"allowed_programs": None})).json()["allowed_programs"] is None
    # 새 매니저: 고른 것만
    import uuid
    r = await c.post("/managers", headers=ho, json={"email": f"perm-new-{uuid.uuid4().hex[:6]}@x.com", "nickname": "신규",
                                                     "allowed_programs": ["customers", "retirement"]})
    assert r.status_code == 201 and r.json()["allowed_programs"] == ["customers", "retirement"], r.text
