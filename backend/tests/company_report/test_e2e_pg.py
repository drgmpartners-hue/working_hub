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
    import tempfile

    os.environ["COMPANY_DB_ROOT"] = tempfile.mkdtemp(prefix="cr-e2e-")


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
        elif "핵심 사건" in prompt:
            data = {"events": [{"date": datetime.now().date().isoformat(), "type": "funding", "title": "테스트바이오 시리즈B 150억 투자 유치"},
                               {"date": (datetime.now().date() - timedelta(days=40)).isoformat(), "type": "award", "title": "테스트바이오 혁신상 수상"}]}
        elif "최종 검토자" in prompt:
            sids = re.findall(r"^\[([oc]\d+)\]", prompt, re.M)
            data = {"final": [{"id": s, "decision": "keep"} for s in sids]}
        else:
            data = {}
        return llm_client.LLMResult(text="{}", data=data, model="fake-claude", usage={"input_tokens": 1})

    async def gemini_json(api_key, prompt, **kw):
        if "핵심 사건" in prompt:
            return llm_client.LLMResult(text="{}", data={"events": [{"date": datetime.now().date().isoformat(), "type": "funding",
                                                                    "title": "테스트바이오, 시리즈B 150억원 유치"}]}, model="fake-gemini")
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
        for t in ["monthly_briefings", "company_monthly_digests", "company_file_downloads", "company_files", "company_public_data", "search_index", "company_facts", "company_funding_rounds", "company_period_summaries", "ai_review_logs",
                  "briefing_send_logs", "briefing_recipients", "news_briefings", "news_articles", "company_keywords",
                  "backfill_jobs", "portfolio_companies"]:
            await db.execute(text(f"DELETE FROM {t}"))
        await db.execute(text("DELETE FROM app_settings WHERE key LIKE 'kipris_calls_%' OR key LIKE 'news_briefing_%' "
                              "OR key LIKE 'company_db_files_%' OR key = 'company_report_admin_ids'"))
        await db.execute(text("DELETE FROM clients WHERE name = '김민호'"))
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

        # ---- 기업DB: 업로드(이름 규칙)·본문 검색·자동 파일·브리핑 PDF·zip
        import io, zipfile
        md = "# IR 요약\n매출 120억, 글로벌 임상 2상 진입".encode("utf-8")
        r = await c.post("/db/files", headers=H, data={"company_id": cid, "folder": "docs", "doc_kind": "IR자료"},
                         files={"file": ("IR 요약 (최종).md", md, "text/markdown")})
        assert r.status_code == 201, r.text
        up = r.json()
        assert up["display_name"].startswith("테스트바이오_IR자료_") and up["display_name"].endswith("_IR요약(최종).md"), up
        bad = await c.post("/db/files", headers=H, data={"company_id": cid, "folder": "docs"}, files={"file": ("x.exe", b"MZ", "application/octet-stream")})
        assert bad.status_code == 422
        r = await c.get("/db/files", params={"q": "임상"}, headers=HS)  # 본문 검색
        assert r.json()["total"] == 1
        r = await c.get("/db/files", params={"q": "테바"}, headers=HS)  # 별칭으로 기업 파일 찾기
        assert r.json()["total"] >= 1
        r = await c.get("/search", params={"q": "임상 2상"}, headers=HS)
        assert r.json()["counts"].get("file") == 1
        r = await c.get(f"/db/files/{up['id']}/download", headers=HS)
        assert r.status_code == 200 and r.content == md and "filename*=UTF-8''" in r.headers["content-disposition"]
        assert (await c.patch(f"/db/files/{up['id']}", headers=HS, json={"deleted": True})).status_code == 403  # 올린 사람 아님
        r = await c.post(f"/db/companies/{cid}/refresh", headers=H)
        assert set(r.json()["files"]) >= {"facts_xlsx", "funding_xlsx", "card_pdf"}, r.json()
        from app.services.company_report import file_worker
        fw = await file_worker.run_once(force=True)
        assert fw["briefing_pdfs"] == 1, fw
        r = await c.get("/db/tree", headers=H)
        tr = r.json()
        assert tr["portfolio"]["total"] == 1 and tr["companies"][0]["counts"]["info"] == 3 and tr["companies"][0]["counts"]["docs"] == 1, tr
        r = await c.get("/db/files", params={"folder": "info", "company": cid}, headers=H)
        card = next(f for f in r.json()["items"] if f["doc_kind"] == "기업카드")
        pdf = (await c.get(f"/db/files/{card['id']}/download", headers=H)).content
        assert pdf.startswith(b"%PDF")
        r = await c.get(f"/db/companies/{cid}/zip", headers=H)
        names = zipfile.ZipFile(io.BytesIO(r.content)).namelist()
        assert any(n.startswith("테스트바이오/01_기업정보/테스트바이오_기업카드_") for n in names), names
        assert any(n.startswith("테스트바이오/03_자료/") for n in names)
        r = await c.patch(f"/db/files/{up['id']}", headers=H, json={"deleted": True})
        assert r.json()["status"] == "deleted"
        r = await c.get("/search", params={"q": "임상 2상"}, headers=HS)
        assert r.json()["counts"].get("file", 0) == 0

        # ---- 공공데이터(가짜 응답): 국민연금 추이·국세청 폐업 → 주의 사실 후보·KIPRIS 한도 기록
        from app.services.collectors import public_data_clients as pdc
        from app.services.company_report import public_data

        async def pd_key(db, provider, user_id=None):
            return ("dg", "") if provider in ("data_go_kr", "kipris") else None

        monkeypatch.setattr(public_data, "get_service_key", pd_key)

        async def fake_nps(key, name, biz):
            return {"found": True, "members": 42, "data_month": "202608", "joined": 3, "left": 1, "status": "가입"}

        async def fake_nts(key, nums):
            return {pdc.digits(n): {"b_stt": "폐업자", "b_stt_cd": "03", "tax_type": "", "end_dt": "20260901"} for n in nums}

        async def fake_kipris(key, applicant, max_pages=2, rows=100):
            return {"total": 1, "calls": 1, "items": [{"applicantName": "(주)테스트바이오", "applicationDate": "20260101",
                                                         "registerStatus": "등록", "inventionTitle": "진단 키트"}]}

        monkeypatch.setattr(pdc, "nps_snapshot", fake_nps)
        monkeypatch.setattr(pdc, "nts_status", fake_nts)
        monkeypatch.setattr(pdc, "kipris_patents", fake_kipris)
        assert (await c.put(f"/companies/{cid}", headers=H, json={"biz_reg_no": "1234567890"})).status_code == 200
        r = await c.post(f"/companies/{cid}/public-data/refresh", headers=H)
        pd = r.json()
        assert pd["result"] == {"nps": "ok", "nts": "ok", "kipris": "ok"}, pd["result"]
        assert pd["latest"]["nps"]["data"]["members"] == 42 and pd["latest"]["kipris"]["data"]["total"] == 1
        assert pd["nps_trend"][0]["members"] == 42
        r = await c.get(f"/companies/{cid}/facts", params={"status": "candidate"}, headers=H)
        assert any("폐업자" in f["title"] for f in r.json()["items"])
        async with AsyncSessionLocal() as db:
            again = await public_data.snapshot_due(db)
            assert again["companies"] == 0  # 이번 달은 이미 있음
            assert await settings_store.get(db, f"kipris_calls_{today_kst().strftime('%Y%m')}") == "1"

        # ---- 과거 데이터 구축(완성판) + 검증 ①~⑥
        from app.services.collectors import google_news_rss
        from app.services.company_report import backfill

        async def fake_range(query, start, end, step_days=7, pause=0.6, client=None):
            base = now_kst()
            items = [
                # 네이버와 같은 기사(다른 URL) → 묶음, 겹침으로 수집률 추정
                {"title": "테스트바이오, 시리즈B 150억 투자 유치", "url": f"https://news.google.com/a/{uuid.uuid4().hex[:6]}",
                 "press": "예시일보", "published_at": base - timedelta(hours=5), "description": "", "source": "google_rss"},
                {"title": "테스트바이오 혁신상 수상", "url": "https://news.google.com/a/award", "press": "산업신문",
                 "published_at": base - timedelta(days=40), "description": "테스트바이오", "source": "google_rss"},
            ]
            return {"items": items, "windows": 26, "saturated": [], "errors": 0}

        monkeypatch.setattr(google_news_rss, "search_range", fake_range)
        monkeypatch.setattr(backfill.cc, "get_service_key", fake_key)
        r = await c.post("/companies/backfill", headers=H, json={"company_ids": [cid], "months": 3})
        assert r.json()["queued"] == 1, r.json()
        job_id = r.json()["job_ids"][0]
        j = (await c.get(f"/backfill-jobs/{job_id}", headers=H)).json()
        assert j["status"] == "done", j
        assert j["source_stats"]["attached"] >= 1  # 구글 기사가 기존 네이버 기사 묶음에 붙음
        ch = j["checks"]
        assert ch["c3"]["pass"] is True and len(j["key_events"]["events"]) == 2, (ch["c3"], j["key_events"])
        assert ch["c5"]["pass"] is None
        assert j["verdict"] == "insufficient" and "기사" in j["reasons"][0], j  # 대표 기사 5건 미만 → 부족
        assert ch["c4"]["pass"] is None  # DART 등록사 아님
        assert j["report_file_id"]
        zero = ch["c1"]["zero_months"]
        s_ = (await c.get(f"/backfill-jobs/{job_id}/sample", headers=H)).json()
        assert 1 <= len(s_["items"]) <= 20
        answers = {a["id"]: True for a in s_["items"]}
        r = await c.post(f"/backfill-jobs/{job_id}/sample-review", headers=H, json={"answers": answers})
        assert r.json()["checks"]["c5"]["pass"] is True
        if zero:
            r = await c.post(f"/backfill-jobs/{job_id}/confirm-gaps", headers=H, json={"months": zero})
        j = r.json()
        assert j["checks"]["c1"]["pass"] is True, j["checks"]["c1"]
        assert j["verdict"] == "insufficient"
        # 판정 규칙(기사 충분할 때): ⑤ 대기면 보완 필요, 모두 통과면 충분
        from app.services.company_report import coverage_check as cc
        ok = {k: {"pass": True} for k in ("c1", "c2", "c3", "c4", "c5", "c6")}
        assert cc.decide(ok, 30) == ("sufficient", [])
        assert cc.decide({**ok, "c5": {"pass": None}}, 30)[0] == "needs_more"
        assert cc.decide({**ok, "c2": {"pass": False, "note": "추정 수집률 80%"}}, 30)[1] == ["② 수집률 미통과: 추정 수집률 80%"]
        r = await c.get(f"/db/files/{j['report_file_id']}/download", headers=H)
        assert r.content.startswith(b"%PDF")

        # ---- 재색인
        r = await c.post("/search/reindex", headers=H)
        st = r.json()
        assert st["company"] == 1 and st["article"] == 3 and st["fact"] >= 2 and st["funding"] == 1 and st["daily"] == 1, st
        assert st["file"] == 6, st  # 뉴스 md 1 + 원장·투자유치 xlsx 2 + 기업카드 1 + 브리핑 PDF 1 + 검증 결과서 1

        # ---- 2단계 삭제: 1단계(화면에서 삭제) → 복구 → 다시 1단계 → 2단계(폴더까지 완전 삭제)
        from pathlib import Path

        from app.services.company_report import storage
        folder = Path(storage.root()) / cid
        assert folder.exists()
        assert (await c.post(f"/companies/{cid}/purge", headers=H, json={"confirm_name": "테스트바이오"})).status_code == 409  # 1단계 전
        assert (await c.post(f"/companies/{cid}/trash", headers=HS)).status_code == 200  # 직원도 1단계 가능
        assert all(x["id"] != cid for x in (await c.get("/companies", headers=H)).json())
        assert [x["id"] for x in (await c.get("/companies", params={"deleted": "true"}, headers=H)).json()] == [cid]
        res = (await c.get("/search", params={"q": "테스트바이오"}, headers=H)).json()
        assert all(i["company_id"] != cid for i in res["items"]) and set(res["counts"]) <= {"briefing", "file", "all"}, res
        # 남는 것은 지난 데일리 브리핑(발송 기록)과 그 PDF뿐
        assert (await c.get("/search/suggest", params={"q": "테스"}, headers=H)).json() == []
        assert all(x["id"] != cid for x in (await c.get("/db/tree", headers=H)).json()["companies"])
        r = await c.post("/companies", headers=H, json={"name": "테스트바이오", "backfill_months": 0})
        assert r.status_code == 409 and "삭제된 기업" in r.json()["detail"]
        assert folder.exists()  # 1단계는 폴더 유지
        r = await c.post(f"/companies/{cid}/restore", headers=H)
        assert r.status_code == 200 and r.json()["articles"] >= 1
        assert (await c.get("/search", params={"q": "시리즈B"}, headers=H)).json()["total"] >= 1  # 색인 복구
        assert (await c.post(f"/companies/{cid}/trash", headers=H)).status_code == 200
        ps = (await c.get(f"/companies/{cid}/purge-summary", headers=H)).json()
        assert ps["trashed"] and ps["articles"] >= 3 and ps["files"] >= 4, ps
        assert (await c.post(f"/companies/{cid}/purge", headers=HS, json={"confirm_name": "테스트바이오"})).status_code == 403
        assert (await c.post(f"/companies/{cid}/purge", headers=H, json={"confirm_name": "테스트"})).status_code == 409
        r = await c.post(f"/companies/{cid}/purge", headers=H, json={"confirm_name": "테스트바이오"})
        assert r.status_code == 200 and r.json()["folder_removed"] is True, r.text
        assert (await c.get(f"/companies/{cid}", headers=H)).status_code == 404
        assert not folder.exists()
        async with AsyncSessionLocal() as db:
            left = (await db.execute(text("select (select count(*) from news_articles where company_id=:c) + "
                                          "(select count(*) from company_facts where company_id=:c) + "
                                          "(select count(*) from company_files where company_id=:c) + "
                                          "(select count(*) from search_index where company_id=:c)"), {"c": cid})).scalar()
            assert left == 0
        r = await c.get("/briefings/daily", params={"date": tomorrow.isoformat()}, headers=H)
        assert r.status_code == 200  # 지난 브리핑(발송 기록)은 남는다

        # ---- 수신자: 고객 정보 관리(clients)에서 이름으로 찾아 추가 → 발송 대상에 포함
        from app.models.client import Client
        async with AsyncSessionLocal() as db:
            cl = Client(user_id=admin_id, name="김민호", phone="010-5555-6666")
            cl2 = Client(user_id=admin_id, name="김민호", phone=None)
            db.add_all([cl, cl2])
            await db.commit()
            cl_id, cl2_id = cl.id, cl2.id
        r = await c.get("/recipients/search", params={"q": "민호"}, headers=HS)
        found = [x for x in r.json() if x["kind"] == "client"]
        assert {x["ref_id"] for x in found} >= {cl_id, cl2_id} and any(x["phone_masked"] == "010-****-6666" for x in found)
        assert (await c.post("/recipients", headers=HS, json={"kind": "client", "ref_id": cl_id})).status_code == 403  # 관리자만
        assert (await c.post("/recipients", headers=H, json={"kind": "client", "ref_id": cl2_id})).status_code == 422  # 번호 없음
        assert (await c.post("/recipients", headers=H, json={"kind": "client", "ref_id": cl_id})).status_code == 201
        assert (await c.post("/recipients", headers=H, json={"kind": "client", "ref_id": cl_id})).status_code == 409
        sel = (await c.get("/recipients", headers=H)).json()["selected"]
        assert {x["name"] for x in sel} == {"관리자", "직원", "김민호"}, sel
        rid = next(x["id"] for x in sel if x["kind"] == "client")
        sent.clear()
        r = await c.post(f"/recipients/{rid}/test-send", headers=H)
        assert r.status_code == 200 and r.json()["to"] == "김민호" and sent[0]["to"] == "010-5555-6666", r.text
        async with AsyncSessionLocal() as db:
            tg = await sender.recipient_targets(db)
            assert sorted(t.phone for t in tg) == ["010-1111-2222", "010-3333-4444", "010-5555-6666"]
        assert (await c.delete(f"/recipients/{rid}", headers=H)).status_code == 204

        # ---- 관리자 지정: 기업 리포트 관리자가 없으면 첫 사용자가 지정, 그다음부터는 관리자만 추가
        me_s = (await c.get("/me", headers=HS)).json()
        assert me_s["is_admin"] is False and me_s["can_claim"] is True
        assert (await c.put("/settings", headers=HS, json={"weather_region": "부산"})).status_code == 403
        assert (await c.post("/admins/claim", headers=HS)).status_code == 200
        assert (await c.get("/me", headers=HS)).json() == {**me_s, "is_admin": True, "can_claim": False}
        assert (await c.put("/settings", headers=HS, json={"weather_region": "부산"})).status_code == 200
        assert (await c.post("/admins/claim", headers=H)).status_code == 409
        names = {a["name"] for a in (await c.get("/admins", headers=HS)).json()}
        assert names == {"관리자", "직원"}


def test_e2e(monkeypatch):
    asyncio.run(_run(monkeypatch))
