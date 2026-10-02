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


@pytest.mark.skipif(not PG, reason="PERM_PG_URL 없음(실제 PostgreSQL 필요)")
async def test_product_master_conflicts_clear_and_delete_usage(env):  # noqa: F811
    """수정_tasks P2-10: 중복 이름 409(500 아님), 칸 비우기, 쓰는 곳이 있으면 삭제 전 확인."""
    import uuid

    from app.models.recommended_portfolio import RecommendedPortfolioItem

    c, d, hdr = env["c"], env["d"], env["hdr"]
    h = hdr(d["owner"])
    n1, n2 = f"상품-{uuid.uuid4().hex[:6]}", f"상품-{uuid.uuid4().hex[:6]}"
    a = (await c.post("/product-master", headers=h, json={"product_name": n1, "region": "국내", "risk_level": "중위험"})).json()
    b = (await c.post("/product-master", headers=h, json={"product_name": f"  {n2}  "})).json()
    assert b["product_name"] == n2
    assert (await c.post("/product-master", headers=h, json={"product_name": n1})).status_code == 409
    assert (await c.post("/product-master", headers=h, json={"product_name": "   "})).status_code == 422
    r = await c.put(f"/product-master/{b['id']}", headers=h, json={"product_name": n1})
    assert r.status_code == 409  # 예전 500
    r = await c.put(f"/product-master/{a['id']}", headers=h, json={"region": None, "risk_level": ""})
    assert r.status_code == 200 and r.json()["region"] is None and r.json()["risk_level"] is None
    assert (await c.put(f"/product-master/{a['id']}", headers=h, json={"product_name": ""})).status_code == 422
    # 쓰는 곳이 있으면 409 + 사용처, force 로 삭제
    async with env["Session"]() as db:
        item = RecommendedPortfolioItem(product_name=n1)
        db.add(item)
        await db.commit()
        item_id = item.id
    u = (await c.get(f"/product-master/{a['id']}/usage", headers=h)).json()
    assert u["recommended_items"] == 1 and u["total"] == 1
    r = await c.delete(f"/product-master/{a['id']}", headers=h)
    assert r.status_code == 409 and r.json()["detail"]["usage"]["recommended_items"] == 1
    assert (await c.delete(f"/product-master/{a['id']}?force=true", headers=h)).status_code == 204
    assert (await c.delete(f"/product-master/{b['id']}", headers=h)).status_code == 204
    async with env["Session"]() as db:
        await db.delete(await db.get(RecommendedPortfolioItem, item_id))
        await db.commit()


@pytest.mark.skipif(not PG, reason="PERM_PG_URL 없음(실제 PostgreSQL 필요)")
async def test_dashboard_summary_real_data_scoped(env):  # noqa: F811
    """수정_tasks P2-8: 대시보드가 실제 데이터를 담당 범위로 계산."""
    import uuid
    from datetime import date, timedelta

    from app.models.snapshot import PortfolioSnapshot

    c, d, hdr = env["c"], env["d"], env["hdr"]
    today = date.today()
    async with env["Session"]() as db:
        db.add_all([
            PortfolioSnapshot(id=str(uuid.uuid4()), client_account_id=d["account_A"], snapshot_date=today - timedelta(days=200),
                              total_assets=1_000_000, total_purchase=1_000_000, total_evaluation=1_000_000),
            PortfolioSnapshot(id=str(uuid.uuid4()), client_account_id=d["account_A"], snapshot_date=today - timedelta(days=120),
                              total_assets=900_000, total_purchase=1_000_000, total_evaluation=900_000, total_return_rate=-10.0),
        ])
        await db.commit()
    a = (await c.get("/dashboard/summary", headers=hdr(d["A"]))).json()
    assert a["kpi"]["clients"] == 1 and a["kpi"]["aum"] == 900_000 and a["kpi"]["avg_return_rate"] == -10.0
    assert a["aum_trend"][-1]["aum"] == 900_000 and len(a["aum_trend"]) == 12
    badges = {x["badge"] for x in a["alerts"]}
    assert "위험" in badges and "연락 필요" in badges  # -10% · 120일 전 분석
    assert a["account_types"][0]["type"] == "irp"
    b = (await c.get("/dashboard/summary", headers=hdr(d["B"]))).json()
    assert b["kpi"]["aum"] == 0 and b["kpi"]["clients"] == 1
    o = (await c.get("/dashboard/summary", headers=hdr(d["owner"]))).json()
    assert o["kpi"]["clients"] >= 2 and o["kpi"]["aum"] >= 900_000
