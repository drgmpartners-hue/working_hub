"""기업 리포트 E2E(실제 PostgreSQL, 외부 API는 가짜).

실행: CR_PG_URL=postgresql+asyncpg://user:pw@localhost:5432/db  pytest tests/company_report/test_e2e_pg.py
- 마이그레이션이 적용된 빈 DB가 필요하다(alembic upgrade head). 환경변수가 없으면 건너뛴다.
- 흐름: 기업 등록 → 수집 → 요약 → 사실 추출 → 기사 아카이브·기간 요약 → 원장 확정 → 검색
        → 데일리 작성(교차 검토) → 승인 → 발송 → 재색인
"""
import asyncio
import os
import re
import uuid
from datetime import datetime, timedelta

import pytest

PG = os.environ.get("CR_PG_URL")
pytestmark = pytest.mark.skipif(not PG, reason="CR_PG_URL 없음(실제 PostgreSQL 필요)")

if PG:
    os.environ["DATABASE_URL"] = PG
    os.environ.setdefault("SECRET_KEY", "e2e-secret")


def _fake_llm_factory():
    from app.services import llm_client

    def ids(prompt, pat=r"\[id=([0-9a-f-]{36})\]"):
        return re.findall(pat, prompt)

    async def claude_json(api_key, prompt, **kw):
        if "뉴스 요약 담당" in prompt:
            items = []
            for i in ids(prompt):
                seg = prompt.split(f"[id={i}]")[1].split("\n")[0]
                tag = "caution" if "소송" in seg else ("positive" if "투자" in seg else "neutral")
                issue = "소송" if "소송" in seg else ("투자유치" if "투자" in seg else "기타")
                rel = 10 if "동명" in seg else 85
                items.append({"id": i, "summary": f"요약: {seg.strip()[:40]}", "tag": tag, "issue_type": issue, "relevance": rel})
            data = {"items": items}
        elif "기록 담당" in prompt:
            facts = []
            for i in ids(prompt):
                seg = prompt.split(f"[id={i}]")[1].split("\n")[0]
                if "투자" in seg:
                    facts.append({"fact_type": "funding", "fact_date": datetime.now().date().isoformat(),
                                  "title": "시리즈B 150억 원 투자유치", "detail": {"금액": "150억 원"},
                                  "funding": {"round_name": "시리즈B", "amount_krw": 15_000_000_000,
                                              "investors": [{"name": "한빛벤처스", "lead": True}], "is_follow_on": False},
                                  "article_ids": [i]})
                elif "소송" in seg:
                    facts.append({"fact_type": "legal", "title": "특허 침해 소송 피소", "article_ids": [i]})
            data = {"facts": facts}
        elif "동향 정리 담당" in prompt:
            data = {"overview": "투자유치와 소송 이슈가 함께 있었다.", "key_events": [{"date": "2026-09-01", "text": "시리즈B", "source_ids": ["A1"]},
                                                                           {"date": "2026-09-02", "text": "근거없음", "source_ids": ["Z9"]}],
                    "cautions": [], "stats_comment": "기사 증가"}
        elif "아침 브리핑" in prompt:
            srcs = re.findall(r"\[(A\d+)\] \(company_id=([0-9a-f-]{36})\)", prompt)
            data = {"overall": [{"text": "테스트기업이 투자를 유치했다.", "source_ids": [srcs[0][0]]},
                                {"text": "근거 없는 문장", "source_ids": []}],
                    "companies": [{"company_id": srcs[0][1], "text": "투자유치와 소송이 있었다.", "source_ids": [srcs[0][0]]}]}
        elif "최종 검토자" in prompt:
            sids = re.findall(r"^\[([oc]\d+)\]", prompt, re.M)
            data = {"final": [{"id": s, "decision": "keep"} for s in sids]}
        else:
            data = {}
        return llm_client.LLMResult(text="{}", data=data, model="fake-claude", usage={"input_tokens": 1})

    async def gemini_json(api_key, prompt, **kw):
        sids = re.findall(r"^\[([oc]\d+)\]", prompt, re.M)
        return llm_client.LLMResult(text="{}", data={"reviews": [{"id": s, "verdict": "keep"} for s in sids], "missing": []},
                                    model="fake-gemini")

    return claude_json, gemini_json


def _articles(now):
    return [
        {"title": "테스트바이오, 시리즈B 150억 투자 유치", "url": f"https://news.example.com/a1?{uuid.uuid4().hex[:4]}", "description": "테스트바이오 홍길동 대표",
         "published_at": now - timedelta(hours=5), "press": "예시일보"},
        {"title": "테스트바이오, 시리즈B 150억원 투자유치", "url": "https://news.example.com/a2", "description": "테스트바이오",
         "published_at": now - timedelta(hours=4), "press": "다른일보"},  # 유사 기사 → 묶임
        {"title": "테스트바이오 특허 소송 휘말려", "url": "https://news.example.com/a3", "description": "테스트바이오 소송",
         "published_at": now - timedelta(hours=3), "press": "예시일보"},
        {"title": "테스트바이오 동명 식당 개업", "url": "https://news.example.com/a4", "description": "테스트바이오 동명 식당",
         "published_at": now - timedelta(hours=2), "press": "지역신문"},
        {"title": "테스트바이오 아파트 분양", "url": "https://news.example.com/a5", "description": "",
         "published_at": now - timedelta(hours=1), "press": "부동산"},  # 제외어
    ]


async def _run(monkeypatch):
    import httpx
    from sqlalchemy import delete, select, text

    import app.services.company_report as cr_pkg  # noqa: F401
    from app.core.security import create_access_token, get_password_hash
    from app.db.session import AsyncSessionLocal
    from app.main import app
    from app.models.news_briefing import NewsArticle
    from app.models.user import User
    from app.services import llm_client, settings_store, solapi_service
    from app.services.collectors import naver_news_client
    from app.services.company_report import (collector, company_finder, config, daily, facts, keys, period, sender,
                                             summarizer)
    from app.services.company_report.timeutil import now_kst, today_kst

    # ---- 가짜 외부 연결
    async def fake_key(db, provider, user_id=None):
        return None if provider in ("data_go_kr", "kis", "dart") else ("k", "s")

    for m in (keys, collector, summarizer, facts, period, daily, company_finder):
        if hasattr(m, "get_service_key"):
            monkeypatch.setattr(m, "get_service_key", fake_key)
    now = now_kst()
    arts = _articles(now)

    async def fake_since(cid, secret, q, since, max_items=1000):
        return {"items": [dict(a) for a in arts], "hit_limit": False, "oldest": arts[0]["published_at"]}

    monkeypatch.setattr(naver_news_client, "search_since", fake_since)
    cj, gj = _fake_llm_factory()
    monkeypatch.setattr(llm_client, "claude_json", cj)
    monkeypatch.setattr(llm_client, "gemini_json", gj)

    async def fake_weather(key, day, region="서울"):
        return {"region": region, "available": True, "text": "맑음, 14~25℃"}

    async def fake_indices(day, kis=None):
        return [{"key": "sp500", "name": "S&P500", "market": "US", "available": True, "close": 5800.0, "change_pct": 0.4}]

    monkeypatch.setattr(daily.data_go_kr, "get_weather", fake_weather)
    monkeypatch.setattr(daily, "previous_day_indices", fake_indices)
    sent = []

    async def fake_send(db, msgs, sender_=None, **kw):
        sent.extend(msgs)
        return {"success": True, "groupId": "G1"}

    monkeypatch.setattr(solapi_service, "send_many_alimtalk", fake_send)

    # ---- 사용자
    async with AsyncSessionLocal() as db:
        for t in ["search_index", "company_facts", "company_funding_rounds", "company_period_summaries", "ai_review_logs",
                  "briefing_send_logs", "briefing_recipients", "news_briefings", "news_articles", "company_keywords",
                  "backfill_jobs", "portfolio_companies"]:
            await db.execute(text(f"DELETE FROM {t}"))
        await db.execute(delete(User).where(User.email.like("e2e-%")))
        admin = User(email=f"e2e-{uuid.uuid4().hex[:6]}@x.com", hashed_password=get_password_hash("pw"), nickname="관리자",
                     phone="010-1111-2222", is_active=True, is_superuser=True)
        staff = User(email=f"e2e-{uuid.uuid4().hex[:6]}@x.com", hashed_password=get_password_hash("pw"), nickname="직원",
                     phone="010-3333-4444", is_active=True, is_superuser=False)
        db.add_all([admin, staff])
        await db.commit()
        admin_id, staff_id = admin.id, staff.id
    H = {"Authorization": f"Bearer {create_access_token(admin_id)}"}
    HS = {"Authorization": f"Bearer {create_access_token(staff_id)}"}

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t/api/v1/company-report") as c:
        r = await c.get("/me", headers=H)
        assert r.status_code == 200 and r.json()["is_admin"] is True

        # ---- 기업 등록(백필 없음)
        r = await c.post("/companies", headers=H, json={
            "name": "테스트바이오", "ceo_name": "홍길동", "aliases": ["테바"],
            "keywords": {"required": ["테스트바이오"], "boost": ["홍길동"], "exclude": ["아파트"]}, "backfill_months": 0})
        assert r.status_code == 201, r.text
        cid = r.json()["id"]
        assert (await c.post("/companies", headers=H, json={"name": "테스트바이오", "backfill_months": 0})).status_code == 409

        # ---- 수집·요약·사실 추출
        async with AsyncSessionLocal() as db:
            st = await collector.collect_company(db, cid, via="manual", since=now - timedelta(days=1))
            assert st["new"] == 4 and st["excluded"] == 1, st
            s2 = await summarizer.summarize_pending(db, company_id=cid)
            assert s2["summarized"] == 3, s2  # 대표 기사 3건(유사 기사 1건 묶임)
            hidden = (await db.execute(select(NewsArticle).where(NewsArticle.is_hidden == True))).scalars().all()  # noqa: E712
            assert len(hidden) == 1 and "동명" in hidden[0].title
            f = await facts.extract_pending(db, company_id=cid)
            assert f["added"] == 2 and f["rounds"] == 1, f
            f2 = await facts.extract_pending(db, company_id=cid)
            assert f2["added"] == 0  # 다시 돌려도 중복 없음

        # ---- 기사 아카이브
        month = now.strftime("%Y-%m")
        r = await c.get(f"/companies/{cid}/article-dates", params={"month": month}, headers=H)
        days = r.json()
        assert sum(d["count"] for d in days) == 2 and sum(d["caution"] for d in days) == 1, days
        r = await c.get(f"/companies/{cid}/articles", params={"date": now.date().isoformat()}, headers=H)
        assert r.json()["total"] == 2
        r = await c.post(f"/companies/{cid}/period-summary", headers=H,
                         json={"date_from": (now.date() - timedelta(days=7)).isoformat(), "date_to": now.date().isoformat()})
        ps = r.json()
        assert r.status_code == 200 and ps["content"]["overview"] and len(ps["content"]["key_events"]) == 1, ps
        r = await c.post(f"/companies/{cid}/period-summary", headers=H,
                         json={"date_from": (now.date() - timedelta(days=7)).isoformat(), "date_to": now.date().isoformat()})
        assert r.json()["cached"] is True

        # ---- 원장
        r = await c.get(f"/companies/{cid}/facts", headers=H)
        fl = r.json()["items"]
        assert len(fl) == 2 and all(x["status"] == "candidate" for x in fl)
        legal = next(x for x in fl if x["fact_type"] == "legal")
        fund = next(x for x in fl if x["fact_type"] == "funding")
        assert (await c.patch(f"/facts/{legal['id']}", headers=H, json={"status": "rejected"})).json()["status"] == "rejected"
        edited = (await c.patch(f"/facts/{fund['id']}", headers=H, json={"title": "시리즈B 150억 원 유치(확정)"})).json()
        assert edited["status"] == "confirmed" and edited["supersedes_id"] == fund["id"]
        r = await c.get(f"/companies/{cid}/funding-rounds", headers=H)
        rounds = r.json()
        assert len(rounds) == 1 and rounds[0]["amount"] == 15_000_000_000 and rounds[0]["investors"][0]["name"] == "한빛벤처스"
        r = await c.patch(f"/funding-rounds/{rounds[0]['id']}", headers=H, json={"status": "confirmed"})
        assert r.json()["status"] == "confirmed"

        # ---- 검색
        r = await c.get("/search", params={"q": "시리즈B"}, headers=HS)
        res = r.json()
        assert res["counts"].get("ledger", 0) >= 2 and res["counts"].get("article", 0) >= 1, res["counts"]
        assert not any("특허 침해 소송" in i["title"] for i in res["items"])  # 제외한 사실은 검색 안 됨
        r = await c.get("/search", params={"q": "테바"}, headers=HS)  # 별칭 → 기업명
        assert r.json()["counts"].get("company") == 1
        r = await c.get("/search", params={"q": "테스트 바이오"}, headers=HS)  # 띄어쓰기 무시
        assert r.json()["counts"].get("company") == 1, r.json()["counts"]
        r = await c.get("/search", params={"q": '"150억 원 유치"'}, headers=HS)
        assert r.json()["counts"].get("ledger") == 1
        r = await c.get("/search/suggest", params={"q": "테스"}, headers=HS)
        assert r.json()[0]["name"] == "테스트바이오"

        # ---- 데일리 → 승인 → 발송
        async with AsyncSessionLocal() as db:
            await settings_store.set_value(db, config.BRIEFING_ENABLED, "1")
            await settings_store.set_value(db, config.REVIEW_UNTIL, (today_kst() + timedelta(days=3)).isoformat())
        r = await c.put("/recipients", headers=H, json={"user_ids": [admin_id, staff_id]})
        assert r.status_code == 200, r.text
        tomorrow = today_kst() + timedelta(days=1)
        async with AsyncSessionLocal() as db:
            out = await daily.build_daily(db, tomorrow, collect=False, force=True, use_deadline=False)
        assert out["status"] == "draft" and out["fallback"] is False, out
        r = await c.get("/briefings/daily", params={"date": tomorrow.isoformat()}, headers=HS)
        b = r.json()
        assert [s["text"] for s in b["overall"]] == ["테스트기업이 투자를 유치했다."], b["overall"]  # 근거 없는 문장 삭제
        assert b["company_summaries"][0]["caution_count"] == 1
        assert (await c.post(f"/briefings/daily/{b['id']}/approve", headers=HS)).status_code == 403
        async with AsyncSessionLocal() as db:
            assert "held" in await sender.send_daily(db, tomorrow)
        assert (await c.post(f"/briefings/daily/{b['id']}/approve", headers=H)).json()["status"] == "approved"
        async with AsyncSessionLocal() as db:
            res = await sender.send_daily(db, tomorrow)
            assert res["success"] and res["count"] == 2 and res["channel"] == "lms", res
            again = await sender.send_daily(db, tomorrow)
            assert again.get("skipped") == "이미 발송됨"
        assert len(sent) == 2 and "브리핑 보기" in sent[0]["text"]
        r = await c.get("/settings", headers=H)
        assert r.json()["send_logs"][0]["status"] == "requested"

        # ---- 재색인
        r = await c.post("/search/reindex", headers=H)
        st = r.json()
        assert st["company"] == 1 and st["article"] == 2 and st["fact"] == 1 and st["funding"] == 1 and st["daily"] == 1, st


def test_e2e(monkeypatch):
    asyncio.run(_run(monkeypatch))
