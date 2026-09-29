"""사실 원장 자동 검증 E2E — 실제 PostgreSQL, AI·기사 원문은 가짜.

실행: CR_PG_URL=postgresql+asyncpg://user:pw@localhost:5432/db  pytest tests/company_report/test_fact_verify_pg.py
경우: 공시(공식) · 여러 매체 · 단일 출처 · 다른 회사 이야기 · 원문에 없음 · 전망 · 출처 어긋남 · 일부 다름(고쳐서 확정) · AI 실패(재시도)
"""
import asyncio
import os
import uuid
from datetime import date, datetime

import pytest

PG = os.environ.get("CR_PG_URL")
pytestmark = pytest.mark.skipif(not PG, reason="CR_PG_URL 없음(실제 PostgreSQL 필요)")

if PG:
    os.environ["DATABASE_URL"] = PG
    os.environ.setdefault("SECRET_KEY", "e2e-secret")


def test_decide_rules():
    from app.services.company_report import fact_verify as fv

    ok = {"about_company": True, "supported": "yes", "speculative": False}
    assert fv.decide({**ok, "about_company": False}, None, False, 3)["status"] == "rejected"
    assert fv.decide({**ok, "supported": "no"}, None, True, 3)["level"] == "not_in_source"
    assert fv.decide({**ok, "speculative": True}, None, False, 3)["level"] == "speculative"
    assert fv.decide(ok, {"verdict": "contradicted"}, False, 2) == {**fv.decide(ok, {"verdict": "contradicted"}, False, 2), "status": "candidate"}
    assert fv.decide(ok, {"verdict": "contradicted"}, True, 1)["level"] == "official"  # 공시가 이긴다
    assert fv.decide(ok, None, False, 2)["level"] == "multi"
    one = fv.decide(ok, {"verdict": "not_found"}, False, 1)
    assert one["status"] == "confirmed" and one["level"] == "single"  # 단일 출처도 자동 확정(표시)
    assert fv.label_of({"level": "single"}) == "단일 출처" and fv.label_of({"level": "multi", "outlets": 3}) == "출처 3곳"
    n, keys = fv.count_outlets([("미디어펜", "https://www.mediapen.com/1"), ("미디어펜", "https://www.mediapen.com/2")],
                               [{"press": "", "url": "https://www.mediapen.com/3"}, {"press": "연합뉴스", "url": "https://yna.co.kr/9"},
                                {"press": "", "url": "https://vertexaisearch.cloud.google.com/x"}])
    assert n == 2 and keys == ["미디어펜", "연합뉴스"]


async def _run(monkeypatch):
    from sqlalchemy import select, text

    from app.db.session import AsyncSessionLocal, engine
    from app.models.company_report import CompanyFact, CompanyFundingRound
    from app.models.news_briefing import NewsArticle, PortfolioCompany
    from app.services import llm_client
    from app.services.company_report import article_reader, fact_verify, facts, keys

    async def fake_key(db, provider, user_id=None):
        return ("k", "s")

    monkeypatch.setattr(keys, "get_service_key", fake_key)
    monkeypatch.setattr(fact_verify, "get_service_key", fake_key)

    async def fake_read(url):
        return {"ok": True, "url": url, "paragraphs": [f"원문 본문 {url}", "회사는 50억 원 투자를 유치했다고 밝혔다."]}

    monkeypatch.setattr(article_reader, "read", fake_read)
    # 사실 제목에 들어 있는 표시어로 가짜 AI 응답을 고른다
    CASES = {
        "공시건": ({"about_company": True, "supported": "yes", "speculative": False, "quote": "공시 원문"}, None),
        "다매체": ({"about_company": True, "supported": "yes", "speculative": False, "quote": "두 매체"}, None),
        "단일건": ({"about_company": True, "supported": "yes", "speculative": False, "quote": "회사는 50억 원 투자를 유치했다고 밝혔다."},
                 {"verdict": "not_found", "sources": []}),
        "검색확인": ({"about_company": True, "supported": "yes", "speculative": False, "quote": "q"},
                  {"verdict": "corroborated", "sources": [{"press": "연합뉴스", "title": "t", "url": "https://yna.co.kr/1"}]}),
        "남의회사": ({"about_company": False, "supported": "yes", "speculative": False, "quote": ""}, None),
        "원문없음": ({"about_company": True, "supported": "no", "speculative": False, "quote": ""}, None),
        "전망건": ({"about_company": True, "supported": "yes", "speculative": True, "quote": "q"}, None),
        "어긋남": ({"about_company": True, "supported": "yes", "speculative": False, "quote": "q"},
                {"verdict": "contradicted", "sources": [{"press": "한경", "url": "https://hankyung.com/1"}], "note": "금액이 다름"}),
        "일부다름": ({"about_company": True, "supported": "partial", "speculative": False, "quote": "q", "role": "",
                  "corrected": {"title": "시리즈A 50억 원 투자유치", "fact_date": "2026-09-02", "detail": {"amount_krw": 5000000000}}},
                 {"verdict": "not_found"}),
        "실패건": (None, None),
    }
    calls = {"claude": 0, "gemini": 0}

    def case_of(prompt):
        return next(v for k, v in CASES.items() if k in prompt)

    async def claude_json(api_key, prompt, **kw):
        calls["claude"] += 1
        check, _ = case_of(prompt)
        if check is None:
            raise llm_client.LLMError("일시 오류")
        assert "원문 본문" in prompt or "공시" in prompt  # 요약이 아니라 원문을 읽는다
        return llm_client.LLMResult(text="{}", data=check, model="fake")

    async def gemini_json(api_key, prompt, **kw):
        calls["gemini"] += 1
        assert kw.get("grounding") is True
        _, s = case_of(prompt)
        return llm_client.LLMResult(text="{}", data=s or {"verdict": "not_found", "sources": []}, model="fake-g")

    monkeypatch.setattr(llm_client, "claude_json", claude_json)
    monkeypatch.setattr(llm_client, "gemini_json", gemini_json)

    await engine.dispose()
    async with AsyncSessionLocal() as db:
        for t in ["search_index", "company_facts", "company_funding_rounds", "news_articles", "portfolio_companies"]:
            await db.execute(text(f"DELETE FROM {t}"))
        co = PortfolioCompany(name="알파바이오", aliases=["알파"])
        db.add(co)
        await db.flush()

        def art(title, press, src="news", grp=None, rep=True):
            a = NewsArticle(company_id=co.id, url=f"https://{uuid.uuid4().hex[:6]}.example.com/n", url_hash=uuid.uuid4().hex,
                            title=title, press=press, source_type=src, published_at=datetime(2026, 9, 1, 9), summary="요약",
                            dup_group_id=grp, is_representative=rep)
            db.add(a)
            return a

        a_dart = art("공시", "DART", src="dart")
        a1 = art("기사1", "미디어펜", grp="g1")
        await db.flush()
        a1.dup_group_id = a1.id
        a2 = art("같은 사건 다른 매체", "연합뉴스", grp=a1.id, rep=False)
        a3 = art("기사3", "미디어펜")
        await db.flush()

        def fact(title, arts, ftype="contract"):
            f = CompanyFact(company_id=co.id, fact_type=ftype, fact_date=date(2026, 9, 1), title=title, status="candidate",
                            origin="ai", detail={"k": "v"},
                            source_refs=[{"article_id": a.id, "url": a.url, "title": a.title} for a in arts])
            db.add(f)
            return f

        fs = {k: fact(k, [a_dart] if k == "공시건" else [a1] if k == "다매체" else [a3],
                      "funding" if k == "일부다름" else "contract") for k in CASES}
        manual = CompanyFact(company_id=co.id, fact_type="other", title="직접 입력", status="confirmed", origin="manual")
        db.add(manual)
        await db.flush()
        rnd = CompanyFundingRound(company_id=co.id, round_name="시리즈A", status="candidate", fact_id=fs["일부다름"].id)
        db.add(rnd)
        await db.commit()
        ids = {k: f.id for k, f in fs.items()}
        rid = rnd.id

    async with AsyncSessionLocal() as db:
        r = await fact_verify.verify_pending(db, limit=50)
    assert r["confirmed"] == 5 and r["rejected"] == 3 and r["candidate"] == 1 and r["error"] == 1, r

    async with AsyncSessionLocal() as db:
        got = {k: await db.get(CompanyFact, i) for k, i in ids.items()}
        lv = {k: (f.status, (f.verification or {}).get("level")) for k, f in got.items()}
        assert lv["공시건"] == ("confirmed", "official")
        assert lv["다매체"] == ("confirmed", "multi") and got["다매체"].verification["outlets"] == 2  # 중복 묶음의 다른 매체
        assert lv["단일건"] == ("confirmed", "single") and got["단일건"].confirmed_by == "auto"
        assert got["단일건"].verification["quote"].startswith("회사는 50억")
        assert lv["검색확인"] == ("confirmed", "multi") and "연합뉴스" in got["검색확인"].verification["outlet_names"]
        assert lv["남의회사"] == ("rejected", "not_company")
        assert lv["원문없음"] == ("rejected", "not_in_source")
        assert lv["전망건"] == ("rejected", "speculative")
        assert lv["어긋남"] == ("candidate", "conflict") and got["어긋남"].verification["search"]["note"] == "금액이 다름"
        assert lv["실패건"] == ("candidate", "error") and got["실패건"].verification["attempts"] == 1
        p = got["일부다름"]
        assert p.status == "confirmed" and p.title == "시리즈A 50억 원 투자유치" and p.fact_date == date(2026, 9, 2)
        assert p.verification["original"]["title"] == "일부다름" and p.detail["amount_krw"] == 5000000000
        assert (await db.get(CompanyFundingRound, rid)).status == "confirmed"  # 투자유치 기록도 같은 판정
        tl = {x["title"]: x for x in facts.fact_timeline(list(got.values()))}
        assert tl["단일건"]["verify_label"] == "단일 출처" and tl["단일건"]["auto"] is True
        assert tl["원문없음"]["verify_label"] == "원문에 없음"

    # 다시 돌리면 실패건만 재시도(공시건 등은 다시 부르지 않음), 3번 실패하면 멈춘다
    before = calls["claude"]
    for _ in range(4):
        async with AsyncSessionLocal() as db:
            await fact_verify.verify_pending(db, limit=50)
    assert calls["claude"] - before == 2  # 2·3번째 시도만
    async with AsyncSessionLocal() as db:
        f = await db.get(CompanyFact, ids["실패건"])
        assert f.verification["attempts"] == 3 and "직접 확인" in f.verification["reason"]
    assert calls["gemini"] >= 5


def test_fact_verify(monkeypatch):
    asyncio.run(_run(monkeypatch))
