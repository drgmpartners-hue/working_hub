"""수정_tasks P1-23·P1-4 — 은퇴 플랜 수정 시 빈 값 방어, 배포 버전 확인."""
import pytest

from tests.test_permissions import PG, env  # noqa: F401


@pytest.mark.skipif(not PG, reason="PERM_PG_URL 없음(실제 PostgreSQL 필요)")
async def test_retirement_plan_put_ignores_null_required_fields(env):  # noqa: F811
    c, d, hdr = env["c"], env["d"], env["hdr"]
    h = hdr(d["A"])
    r = await c.post("/retirement/plans", headers=h, json={"profile_id": d["profile_A"], "current_age": 45,
                                                          "annual_return_rate": 5, "lump_sum_amount": 1000})
    assert r.status_code in (200, 201), r.text
    pid = r.json()["id"]
    # 예전: current_age·annual_return_rate 에 null 이 오면 500
    r = await c.put(f"/retirement/plans/{pid}", headers=h, json={"current_age": None, "annual_return_rate": None,
                                                                  "saving_period_years": 0})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["current_age"] == 45 and float(body["annual_return_rate"]) == 5.0
    # 적립 기간 0년이어도 거치금이 첫해에 들어간다
    assert body["yearly_projections"][0]["lump_sum"] == 1000 and body["yearly_projections"][0]["evaluation"] == 1050.0


async def test_version_endpoint(monkeypatch):
    import httpx

    from app.main import app

    monkeypatch.setenv("RAILWAY_GIT_COMMIT_SHA", "abcdef1234567")
    monkeypatch.setenv("RAILWAY_ENVIRONMENT_NAME", "production")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        r = await c.get("/api/v1/version")
    assert r.status_code == 200 and r.json()["commit"] == "abcdef1" and r.json()["env"] == "production"
