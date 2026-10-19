"""'관련성 없는 기사' 제보 → 관리자 검토(Claude 분석·숨기기·키워드 수정·기존 기사 다시 점검) (2026-10-19)."""
import uuid
from datetime import datetime

import pytest

from tests.test_permissions import PG, env  # noqa: F401


@pytest.mark.skipif(not PG, reason="PERM_PG_URL 없음(실제 PostgreSQL 필요)")
async def test_report_analyze_resolve_and_recheck(env, monkeypatch):  # noqa: F811
    from app.models.news_briefing import NewsArticle
    from app.services import llm_client
    from app.services.company_report import keys, mobile_link

    c, d, hdr, Session = env["c"], env["d"], env["hdr"], env["Session"]
    ha, hb, ho = hdr(d["A"]), hdr(d["B"]), hdr(d["owner"])
    cid = (await c.post("/company-report/companies", headers=ha, json={
        "name": f"비이아이-{uuid.uuid4().hex[:6]}", "backfill_months": 0,
        "keywords": {"required": ["비이아이"], "boost": ["배터리"], "exclude": []}})).json()["id"]
    async with Session() as db:
        bad = NewsArticle(company_id=cid, url="https://news.example/bai", url_hash=uuid.uuid4().hex,
                          title="비이아이 화장품, 신제품 립스틱 출시", description="뷰티 브랜드 비이아이 화장품이 립스틱을 냈다",
                          press="뷰티신문", published_at=datetime(2026, 10, 12, 9))
        same = NewsArticle(company_id=cid, url="https://news.example/bai2", url_hash=uuid.uuid4().hex,
                           title="비이아이 화장품 매장 확대", description="뷰티 매장", published_at=datetime(2026, 10, 10, 9))
        good = NewsArticle(company_id=cid, url="https://news.example/ok", url_hash=uuid.uuid4().hex,
                           title="비이아이, 배터리 소재 수주", description="2차전지 소재", published_at=datetime(2026, 10, 11, 9))
        db.add_all([bad, same, good])
        await db.commit()
        bad_id, same_id, good_id = bad.id, same.id, good.id

    # 제보: 그 기업을 볼 수 있는 사람만, 같은 사람이 또 누르면 같은 제보
    r = await c.post(f"/company-report/articles/{bad_id}/report", headers=ha, json={"reason": "화장품 회사 기사"})
    assert r.status_code == 201 and r.json()["new"]
    rid = r.json()["id"]
    assert (await c.post(f"/company-report/articles/{bad_id}/report", headers=ha, json={})).json() == {"id": rid, "status": "open", "new": False}
    assert (await c.post(f"/company-report/articles/{bad_id}/report", headers=hb, json={})).status_code == 404
    # 폰 화면(카톡 링크)에서 — 열쇠값으로 누가 보냈는지
    t = mobile_link.make("d", "2026-10-12", f"u{d['owner']}")
    r = await c.post("/company-report/m/report-article", params={"t": t}, json={"article_id": bad_id})
    assert r.status_code == 201 and r.json()["new"]
    assert (await c.post("/company-report/m/report-article", params={"t": t[:-2] + "xx"}, json={"article_id": bad_id})).status_code == 403

    # 관리자 목록: 매니저는 못 봄, 대표는 언제·누가·어느 기업·기사
    assert (await c.get("/company-report/article-reports", headers=ha)).status_code == 403
    lst = (await c.get("/company-report/article-reports", headers=ho)).json()
    mine = [x for x in lst["items"] if x["company"]["id"] == cid]
    assert len(mine) == 2 and {x["channel"] for x in mine} == {"web", "mobile"} and mine[0]["same_article_reports"] == 2
    web = next(x for x in mine if x["channel"] == "web")
    assert web["reason"] == "화장품 회사 기사" and web["reporter_name"] and web["article"]["title"].startswith("비이아이 화장품")

    # Claude 분석(가짜): 이미 있는 말을 넣으라는 제안은 걸러진다
    async def fake_key(db, provider, user_id=None):
        return ("k", "")

    seen = {}

    async def fake_json(key, prompt, **kw):
        seen["prompt"] = prompt
        return llm_client.LLMResult(text="", data={
            "verdict": "irrelevant", "confidence": "high", "cause": "동명 회사", "matched_by": "비이아이",
            "reason": "기사는 화장품 브랜드 이야기다.", "hide_article": True, "summary": "동명 화장품 회사 기사",
            "actions": [{"type": "add_exclude", "keyword": "화장품", "why": "동명 브랜드"},
                        {"type": "add_required", "keyword": "비이아이", "why": "이미 있음"},
                        {"type": "nope", "keyword": "x"}]})

    monkeypatch.setattr(keys, "get_service_key", fake_key)
    from app.api.v1 import company_report as cr_api

    backfills = []

    async def no_backfill(*args, **kw):
        backfills.append(args)  # 키워드를 바꾸면 최근 6개월 재수집이 예약된다(시험에서는 실제로 돌리지 않음)

    monkeypatch.setattr(cr_api, "_run_backfill_jobs", no_backfill)
    monkeypatch.setattr(llm_client, "claude_json", fake_json)
    res = (await c.post(f"/company-report/article-reports/{rid}/analyze", headers=ho)).json()
    assert res["verdict"] == "irrelevant" and res["cause"] == "동명 회사"
    assert res["actions"] == [{"type": "add_exclude", "keyword": "화장품", "why": "동명 브랜드"}]
    assert "필수어: 비이아이" in seen["prompt"] and "제보 사유: 화장품 회사 기사" in seen["prompt"]
    assert (await c.post(f"/company-report/article-reports/{rid}/analyze", headers=ha)).status_code == 403

    # 오른쪽 패널에서 키워드 수정(기존 PUT) → 기존 기사 다시 점검: 미리 보기 → 숨기기
    co = (await c.get(f"/company-report/companies/{cid}", headers=ho)).json()
    kw = co["keywords"]
    kw["exclude"] = kw["exclude"] + ["화장품"]
    assert (await c.put(f"/company-report/companies/{cid}", headers=ho, json={"keywords": kw})).status_code == 200
    assert backfills  # 바뀐 키워드로 재수집 예약
    pre = (await c.post(f"/company-report/companies/{cid}/recheck-articles", headers=ho, json={"apply": False})).json()
    assert pre["matched"] == 2 and pre["hidden"] == 0 and "제외어 '화장품'" in pre["samples"][0]["reason"]
    assert (await c.post(f"/company-report/companies/{cid}/recheck-articles", headers=ha, json={})).status_code == 403
    done = (await c.post(f"/company-report/companies/{cid}/recheck-articles", headers=ho, json={"apply": True})).json()
    assert done["hidden"] == 2

    # 처리: 같은 기사의 다른 제보도 함께 닫힘
    out = (await c.post(f"/company-report/article-reports/{rid}/resolve", headers=ho,
                        json={"action": "hide", "note": "제외어 '화장품' 추가"})).json()
    assert out["closed"] == 2 and out["status"] == "resolved" and "제외어" in out["resolution"]
    lst = (await c.get("/company-report/article-reports", headers=ho)).json()
    assert not [x for x in lst["items"] if x["company"]["id"] == cid]  # 검토 대기 목록에서 빠짐
    done_lst = (await c.get("/company-report/article-reports", headers=ho, params={"status": "resolved"})).json()
    assert len([x for x in done_lst["items"] if x["company"]["id"] == cid]) == 2
    async with Session() as db:
        assert (await db.get(NewsArticle, bad_id)).is_hidden and (await db.get(NewsArticle, same_id)).is_hidden
        assert not (await db.get(NewsArticle, good_id)).is_hidden  # 실제 기업 기사는 그대로
