"""단순 언급 기사 거르기: 수집 단계에서 저장하지 않고, 기존 기사는 한 번에 정리(숨기기만) (2026-10-19)."""
import uuid
from datetime import datetime

import pytest

from tests.test_permissions import PG, env  # noqa: F401


@pytest.mark.skipif(not PG, reason="PERM_PG_URL 없음(실제 PostgreSQL 필요)")
async def test_collect_drops_mentions_and_cleanup(env):  # noqa: F811
    from sqlalchemy import select

    from app.models.news_briefing import NewsArticle, PortfolioCompany
    from app.services.company_report import collector

    c, d, hdr, Session = env["c"], env["d"], env["hdr"], env["Session"]
    ha, ho = hdr(d["A"]), hdr(d["owner"])
    nm = f"한미반도체{uuid.uuid4().hex[:4]}"
    cid = (await c.post("/company-report/companies", headers=ha, json={
        "name": nm, "backfill_months": 0, "ceo_name": "곽동신",
        "keywords": {"required": [nm], "boost": [], "exclude": []}})).json()["id"]

    def item(title, desc, src="naver"):
        return {"title": title, "description": desc, "url": f"https://n.example/{uuid.uuid4().hex}",
                "published_at": datetime(2026, 10, 18, 9), "press": "언론", "source": src}

    # ① 수집: 제목·첫머리에 이름이 있는 것만 저장, 본문 중간 한 번 언급은 버림
    async with Session() as db:
        kw = await collector._keywords(db, cid)
        assert nm in kw["names"] and kw["people"] == ["곽동신"]
        st = await collector._store(db, cid, [
            item(f"{nm}, 신형 본더 수주", "수주 소식"),
            item("곽동신 회장 인터뷰", f"HBM 장비 전략을 밝혔다. {nm} 곽동신 회장은"),
            item("반도체 장비 경쟁", f"[서울=뉴시스] 홍길동 기자 = {nm}가 신형 장비를 냈다."),
            item("코스피 반등에도 AI 우려", f"증시가 반등했다. 빅테크 실적에 주목한다. 장비주 중 {nm}도 올랐다고 한 연구원이 말했다."),
            item("[마감시황] 코스닥 1% 하락", f"코스닥이 내렸다. {nm} 2%, A 1%, B 3%"),
            item("곽동신 원장, 정형외과 개원", "곽동신 원장은 김포에 병원을 열었다."),
            item(f"{nm}비 신약 허가", "다른 회사 이야기"),
        ], kw, "daily")
        await db.commit()
        assert st["new"] == 3 and st["excluded"] == 4
        reasons = dict((await db.execute(select(NewsArticle.title, NewsArticle.relevance_reason).where(
            NewsArticle.company_id == cid))).all())
        assert reasons[f"{nm}, 신형 본더 수주"] == f"제목 '{nm}'" and reasons["곽동신 회장 인터뷰"].startswith("제목 대표자")
        titles = set((await db.execute(select(NewsArticle.title).where(NewsArticle.company_id == cid))).scalars())
        assert "코스피 반등에도 AI 우려" not in titles and len(titles) == 3

        # ② 예전 규칙으로 이미 모인 기사(단순 언급)·공시·직접 추가
        old = NewsArticle(company_id=cid, url="https://n.example/old", url_hash=uuid.uuid4().hex,
                          title="코스닥 마감 시황", description=f"지수가 내렸다. 개별 종목으로는 {nm} 등이 올랐다.",
                          published_at=datetime(2026, 10, 10, 9))
        dart = NewsArticle(company_id=cid, url="https://dart.example/1", url_hash=uuid.uuid4().hex, source_type="dart",
                           source="dart", title="[공시] 단일판매ㆍ공급계약체결", description="제출인: 다른이름",
                           published_at=datetime(2026, 10, 10, 9))
        manual = NewsArticle(company_id=cid, url="https://n.example/m", url_hash=uuid.uuid4().hex, source_type="manual",
                             source="manual", title="직접 올린 자료", published_at=datetime(2026, 10, 10, 9))
        db.add_all([old, dart, manual])
        await db.commit()
        old_id, dart_id, manual_id = old.id, dart.id, manual.id

    # ③ 처음 한 번 정리: 매니저는 못 함, 대표는 미리 보기 → 숨기기
    assert (await c.post("/company-report/article-reports/cleanup", headers=ha, json={"apply": False})).status_code == 403
    pv = (await c.post("/company-report/article-reports/cleanup", headers=ho, json={"apply": False})).json()
    mine = next(x for x in pv["companies"] if x["company_id"] == cid)
    assert mine["matched"] == 1 and pv["reasons"].get("주가·시황 나열", 0) >= 1 and pv["hidden"] == 0
    assert any(s["title"] == "코스닥 마감 시황" and s["company"] == nm for s in pv["samples"])
    async with Session() as db:
        assert not (await db.get(NewsArticle, old_id)).is_hidden  # 미리 보기는 바꾸지 않음
    ap = (await c.post("/company-report/article-reports/cleanup", headers=ho, json={"apply": True})).json()
    assert ap["hidden"] == ap["matched"] >= 1
    async with Session() as db:
        o = await db.get(NewsArticle, old_id)
        assert o.is_hidden and o.hidden_by == "rule"           # 지우지 않고 숨김
        assert not (await db.get(NewsArticle, dart_id)).is_hidden   # 공시는 그대로
        assert not (await db.get(NewsArticle, manual_id)).is_hidden  # 직접 추가도 그대로
        kept = (await db.execute(select(NewsArticle).where(
            NewsArticle.company_id == cid, NewsArticle.is_hidden == False))).scalars().all()  # noqa: E712
        assert len(kept) == 5
        assert await db.get(PortfolioCompany, cid)
    # 다시 돌리면 정리할 것이 없음
    again = (await c.post("/company-report/article-reports/cleanup", headers=ho, json={"apply": False})).json()
    assert all(x["company_id"] != cid for x in again["companies"])
    # 패널의 기업별 점검도 같은 규칙(제외어가 없어도 단순 언급을 찾음)
    r = (await c.post(f"/company-report/companies/{cid}/recheck-articles", headers=ho, json={"apply": False})).json()
    assert r["matched"] == 0
