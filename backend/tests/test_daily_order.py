"""데일리 기업 순서: 여러 언론 보도 수·오랜만의 소식 신호를 실제 PostgreSQL에서 계산 (2026-10-19)."""
import uuid
from datetime import datetime

import pytest

from tests.test_permissions import PG, env  # noqa: F401


@pytest.mark.skipif(not PG, reason="PERM_PG_URL 없음(실제 PostgreSQL 필요)")
async def test_ordering_signals_pg(env):  # noqa: F811
    from sqlalchemy import select

    from app.models.news_briefing import NewsArticle, PortfolioCompany
    from app.services.company_report import daily

    c, d, hdr, Session = env["c"], env["d"], env["hdr"], env["Session"]
    ha = hdr(d["A"])
    ids = []
    for n in ("단골", "신규"):
        ids.append((await c.post("/company-report/companies", headers=ha, json={
            "name": f"{n}-{uuid.uuid4().hex[:6]}", "backfill_months": 0,
            "keywords": {"required": [n], "boost": [], "exclude": []}})).json()["id"])
    regular, fresh = ids
    start = datetime(2026, 10, 16, 7)
    g = str(uuid.uuid4())

    def art(cid, when, press, rep=True, group=None, title="기사"):
        return NewsArticle(company_id=cid, url=f"https://n.example/{uuid.uuid4().hex}", url_hash=uuid.uuid4().hex,
                           title=title, press=press, published_at=when, is_representative=rep, dup_group_id=group,
                           tag="neutral", issue_type="기타", relevance_score=60)

    async with Session() as db:
        db.add_all([
            art(regular, datetime(2026, 10, 13, 9), "가신문"),                      # 직전 7일 안에 기사 있음
            art(regular, datetime(2026, 10, 16, 9), "가신문"),
            art(fresh, datetime(2026, 10, 1, 9), "가신문"),                         # 7일보다 전 → 오랜만
            art(fresh, datetime(2026, 10, 16, 9), "나신문", group=g, title="대표"),
            art(fresh, datetime(2026, 10, 16, 9), "다신문", rep=False, group=g),
            art(fresh, datetime(2026, 10, 16, 10), "라신문", rep=False, group=g),
        ])
        await db.commit()
        today = (await db.execute(select(NewsArticle).where(
            NewsArticle.company_id.in_(ids), NewsArticle.is_representative == True,  # noqa: E712
            NewsArticle.published_at >= start))).scalars().all()
        press, new = await daily.ordering_signals(db, list(today), start)
        rep = next(a for a in today if a.title == "대표")
        assert press[rep.id] == 3 and new == {fresh}
        comps = {x.id: x for x in (await db.execute(select(PortfolioCompany).where(PortfolioCompany.id.in_(ids)))).scalars()}
        cards = daily.group_articles(list(today), comps, press, new)
        assert cards[0]["company_id"] == fresh and cards[0]["is_new"]
        # 실패해도 브리핑은 계속되고, 세션도 그대로 쓸 수 있다
        from sqlalchemy import text

        real_execute = db.execute
        calls = {"n": 0}

        async def flaky(stmt, *a, **kw):
            calls["n"] += 1
            if calls["n"] == 2:   # 두 번째 질의에서 DB 오류(첫 질의 결과도 버리고 기본 점수로)
                await real_execute(text("SELECT 1/0"))
            return await real_execute(stmt, *a, **kw)

        db.execute = flaky
        try:
            assert await daily.ordering_signals(db, list(today), start) == ({}, set())
        finally:
            db.execute = real_execute
        assert (await db.execute(select(PortfolioCompany.id).limit(1))).first() is not None
