"""월간 브리핑(P3) E2E — 실제 PostgreSQL, AI·발송은 가짜.

실행: CR_PG_URL=postgresql+asyncpg://user:pw@localhost:5432/db  pytest tests/company_report/test_monthly_pg.py
흐름: 지난 달 기사·원장 준비 → 월간 작성(기업별 요약 → 종합 → 교차 검토) → 저장·색인
      → API 조회·기업 월간 요약 → 보류/발송 허용 → 테스트 발송 → 08:30 배치 발송 조건 → 삭제 비율 30% 초과 시 보류
"""
import asyncio
import os
import re
import uuid
from types import SimpleNamespace
from datetime import date, datetime, timedelta

import pytest

PG = os.environ.get("CR_PG_URL")
pytestmark = pytest.mark.skipif(not PG, reason="CR_PG_URL 없음(실제 PostgreSQL 필요)")

if PG:
    os.environ["DATABASE_URL"] = PG
    os.environ.setdefault("SECRET_KEY", "e2e-secret")


def _fake_llm(state):
    from app.services import llm_client

    async def claude_json(api_key, prompt, **kw):
        if "한 달을 정리" in prompt:
            srcs = re.findall(r"^\[([AF]\d+)\]", prompt, re.M)
            a = [s for s in srcs if s.startswith("A")]
            f = [s for s in srcs if s.startswith("F")] or a
            name = re.search(r"대상: (\S+?)[\s(/]", prompt).group(1)
            data = {
                "summary": [{"text": f"{name}는 이달 시리즈B 투자를 유치했다.", "source_ids": [a[0]]}],
                "facts": [{"date": "", "text": "시리즈B 150억 원 투자유치", "source_ids": [f[0]]},
                          {"date": "", "text": "출처 없는 사실", "source_ids": []}],
                "meaning": {"text": "연구개발 자금을 확보했다는 뜻이다.", "source_ids": [a[0]]},
                "client_explain": {"text": "신규 투자를 유치해 개발 자금을 확보했습니다.", "source_ids": [a[0]]},
                "qa": [{"q": "추가 투자는 있나요?", "a": "기사에 나온 계획은 없습니다.", "source_ids": [a[0]]}],
                "caution": ({"what": {"text": "특허 소송에 휘말렸다.", "source_ids": [a[-1]]},
                             "impact": {"text": "판결 전까지 비용이 들 수 있다.", "source_ids": [a[-1]]},
                             "check": {"text": "소송 대응 계획을 확인한다.", "source_ids": [a[-1]]}} if "소송" in prompt else None),
                "checkpoints": [{"when": "2026-11", "text": "신제품 출시 예정", "source_ids": [a[0]]}],
            }
        elif "월간 브리핑의 앞부분" in prompt:
            cids = re.findall(r"company_id=([0-9a-f-]{36})", prompt)
            srcs = re.findall(r"\[(A\d+)", prompt)
            data = {"summary": [{"text": "포트폴리오 기업 투자유치가 이어졌다.", "source_ids": [srcs[0]]},
                                {"text": "한 기업은 소송 이슈가 있었다.", "source_ids": [srcs[0]]}],
                    "highlights": [{"company_id": cids[0], "text": "시리즈B 유치", "source_ids": [srcs[0]]}]}
        elif "최종 검토자" in prompt:
            sids = re.findall(r"^\[([a-z0-9_]+)\] \(", prompt, re.M)
            data = {"final": [{"id": s, "decision": "remove" if state.get("remove_all") else "keep", "reason": "t"} for s in sids]}
        else:
            data = {}
        state.setdefault("calls", []).append(prompt[:30])
        return llm_client.LLMResult(text="{}", data=data, model="fake-claude", usage={"input_tokens": 1})

    async def gemini_json(api_key, prompt, **kw):
        sids = re.findall(r"^\[([a-z0-9_]+)\] \(", prompt, re.M)
        return llm_client.LLMResult(text="{}", data={"reviews": [{"id": s, "verdict": "keep"} for s in sids], "missing": []},
                                    model="fake-gemini")

    return claude_json, gemini_json


async def _run(monkeypatch):
    import httpx
    from sqlalchemy import select, text

    from app.core.security import create_access_token, get_password_hash
    from app.db.session import AsyncSessionLocal, engine
    from app.main import app
    from app.models.company_report import CompanyFact, CompanyMonthlyDigest, MonthlyBriefing, SearchIndex
    from app.models.news_briefing import BriefingRecipient, NewsArticle, PortfolioCompany
    from app.models.user import User
    from app.services import llm_client, settings_store, solapi_service
    from app.services.collectors import data_go_kr
    from app.services.company_report import config, keys, monthly, sender

    async def fake_key(db, provider, user_id=None):
        return None if provider in ("data_go_kr", "kis", "dart") else ("k", "s")

    for m in (keys, monthly):
        monkeypatch.setattr(m, "get_service_key", fake_key)
    state: dict = {}
    cj, gj = _fake_llm(state)
    monkeypatch.setattr(llm_client, "claude_json", cj)
    monkeypatch.setattr(llm_client, "gemini_json", gj)
    sent = []

    async def fake_send(db, msgs, sender_=None, **kw):
        sent.extend(msgs)
        return {"success": True, "groupId": "G1"}

    monkeypatch.setattr(solapi_service, "send_many_alimtalk", fake_send)

    async def business(key, d):
        return d.weekday() < 5

    monkeypatch.setattr(data_go_kr, "is_business_day", business)

    await engine.dispose()  # 다른 테스트가 만든 연결(다른 이벤트 루프)을 버린다
    month = "2026-08"
    async with AsyncSessionLocal() as db:
        for t in ["monthly_briefings", "company_monthly_digests", "search_index", "company_facts", "company_funding_rounds",
                  "ai_review_logs", "briefing_send_logs", "briefing_recipients", "news_briefings", "news_articles",
                  "company_keywords", "backfill_jobs", "portfolio_companies"]:
            await db.execute(text(f"DELETE FROM {t}"))
        await db.execute(text("DELETE FROM app_settings WHERE key LIKE 'news_briefing_%' OR key LIKE 'monthly_briefing_%' "
                              "OR key = 'company_report_admin_ids'"))
        await db.execute(text("DELETE FROM users WHERE email LIKE 'mb-%'"))
        admin = User(email=f"mb-{uuid.uuid4().hex[:6]}@x.com", hashed_password=get_password_hash("pw"), nickname="관리자",
                     phone="010-1111-2222", is_active=True, is_superuser=True)
        db.add(admin)
        a_co = PortfolioCompany(name="알파바이오", industry="바이오")
        b_co = PortfolioCompany(name="베타로보틱스")
        c_co = PortfolioCompany(name="감마소프트")  # 이번 달 기사 없음, 직전 3개월엔 많았음 → 커버리지 경고
        db.add_all([a_co, b_co, c_co])
        await db.flush()

        def art(cid, title, d, tag, n=0):
            return NewsArticle(company_id=cid, url=f"https://n.example.com/{uuid.uuid4().hex}", url_hash=uuid.uuid4().hex,
                               title=title, published_at=d, summary=f"요약 {title}", tag=tag, relevance_score=80 - n)

        db.add_all([
            art(a_co.id, "알파바이오 시리즈B 150억 유치", datetime(2026, 8, 5, 9), "positive"),
            art(a_co.id, "알파바이오 신제품 11월 출시", datetime(2026, 8, 20, 9), "neutral", 1),
            art(b_co.id, "베타로보틱스 수주", datetime(2026, 8, 7, 9), "positive"),
            art(b_co.id, "베타로보틱스 특허 소송", datetime(2026, 8, 25, 9), "caution", 1),
            art(a_co.id, "알파바이오 7월 기사", datetime(2026, 7, 10, 9), "neutral"),
            art(a_co.id, "9월 기사(대상 아님)", datetime(2026, 9, 1, 9), "neutral"),
        ])
        for mth in (5, 6, 7):
            for i in range(4):
                db.add(art(c_co.id, f"감마 {mth}월 {i}", datetime(2026, mth, 3 + i, 9), "neutral"))
        db.add(CompanyFact(company_id=a_co.id, fact_type="funding", fact_date=date(2026, 8, 5), title="시리즈B 150억 원", status="confirmed"))
        db.add(BriefingRecipient(user_id=admin.id, name="관리자", is_active=True))
        await db.commit()
        admin_id, a_id, b_id, c_id = admin.id, a_co.id, b_co.id, c_co.id
    H = {"Authorization": f"Bearer {create_access_token(admin_id)}"}

    # ---- 날짜 도우미
    assert monthly.prev_month("2026-01") == "2025-12" and monthly.next_month("2026-12") == "2027-01"
    assert monthly.target_month_for(date(2026, 10, 1)) == "2026-09"

    # ---- 배치: 1일이 아니면 건너뜀
    async with AsyncSessionLocal() as db:
        if date.today().day != 1:
            assert "skipped" in await monthly.build_monthly(db)
        r = await monthly.build_monthly(db, month, force=True)
    assert r["status"] == "ready", r
    assert r["companies"] == 2 and r["removed_ratio"] < 0.3, r

    async with AsyncSessionLocal() as db:
        mb = (await db.execute(select(MonthlyBriefing).where(MonthlyBriefing.month == month))).scalar_one()
        st = mb.stats
        assert st["article_count"] == 4 and st["caution_count"] == 1 and st["prev_article_count"] == 5, st
        assert [x["name"] for x in st["coverage_alerts"]] == ["감마소프트"], st["coverage_alerts"]
        c = mb.content
        assert [s["name"] for s in c["companies"]] == ["베타로보틱스", "알파바이오"]  # 주의 기업 먼저
        alpha = next(s for s in c["companies"] if s["name"] == "알파바이오")
        assert len(alpha["facts"]) == 1  # 출처 없는 사실은 삭제
        assert alpha["client_explain"]["text"].endswith("확보했습니다.")
        assert alpha["qa"][0]["q"] == "추가 투자는 있나요?" and alpha["qa"][0]["a"].startswith("기사에")
        assert [x["name"] for x in c["cautions"]] == ["베타로보틱스"] and c["cautions"][0]["check"]["text"]
        assert len(c["checkpoints"]) == 2 and c["summary"] and c["highlights"][0]["name"]
        for sid in alpha["summary"][0]["source_ids"] + alpha["facts"][0]["source_ids"]:
            assert sid in c["sources"], sid
        assert any(v["type"] == "fact" for v in c["sources"].values())
        digs = (await db.execute(select(CompanyMonthlyDigest).where(CompanyMonthlyDigest.month == month))).scalars().all()
        assert {d.company_id for d in digs} == {a_id, b_id, c_id}
        dg = {d.company_id: d for d in digs}
        assert dg[a_id].summary and dg[a_id].article_count == 2 and dg[a_id].key_fact_ids
        assert dg[c_id].summary is None and dg[c_id].content is None
        idx = (await db.execute(select(SearchIndex.entity_type).where(SearchIndex.entity_type.in_(["monthly", "digest"])))).scalars().all()
        assert sorted(idx) == ["digest", "digest", "monthly"]
        mb_id = mb.id

    # ---- 알림톡 변수(템플릿 C) — 1,000자 이내
    async with AsyncSessionLocal() as db:
        mb = await db.get(MonthlyBriefing, mb_id)
        v = sender.template_c_variables(mb, "관리자")
        assert v["#{월}"] == "8월" and v["#{월코드}"] == month and "베타로보틱스" in v["#{주의기업}"]
        assert "11월" in v["#{체크포인트}"]
        txt = sender.render_monthly_text(mb, "관리자")
        assert txt.startswith("[사내 업무용 메시지]\n관리자 담당자님, 8월") and len(txt) < 1000
        assert txt.endswith("아래 버튼에서 확인해 주세요.")
        # 수신자별 열쇠값: 알림톡 버튼 #{월코드} 자리, 문자는 본문 끝에 폰 화면 주소
        rcp = (await db.execute(select(BriefingRecipient))).scalars().first()
        t = SimpleNamespace(name="관리자", recipient_id=rcp.id, user_id=None)
        mtok = sender.monthly_token(mb, t)
        assert sender.template_c_variables(mb, "관리자", mtok)["#{월코드}"] == mtok
        lms = sender.render_monthly_text(mb, "관리자", mtok)
        assert lms.endswith(f"/m/monthly?t={mtok}") and len(lms) <= 1000
        # 짧은 링크(/r) — 나중에 쓸 수 있게 남겨 둔 기능
        from app.services.company_report import shortlink

        sl = await shortlink.codes_for(db, [("https://n.example.com/x", None)])
        await db.commit()
        code = sl["https://n.example.com/x"].rsplit("/", 1)[1]

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t/api/v1/company-report") as cl:
        # 짧은 링크: 로그인 없이 원문으로 이동, 없는 코드는 Working Hub로
        r = await cl.get(f"/r/{code}")
        assert r.status_code == 302 and r.headers["location"].startswith("http") and "/r/" not in r.headers["location"]
        r = await cl.get("/r/NoSuch1")
        assert r.status_code == 302 and r.headers["location"] == "https://working-hub.vercel.app"
        # 폰 전용 화면: 로그인 없이 열쇠값으로, 문장마다 원문 번호
        r = await cl.get("/m/monthly", params={"t": mtok})
        assert r.status_code == 200, r.text
        mv = r.json()
        assert mv["month"] == month and mv["summary"][0]["refs"] and mv["refs"][0]["url"].startswith("https://")
        assert mv["companies"] and mv["companies"][0]["client_explain"]["text"] and "review_summary" not in mv
        assert (await cl.get("/m/monthly", params={"t": mtok[:-2] + "zz"})).status_code == 403
        assert (await cl.get("/m/daily", params={"t": mtok})).status_code == 403  # 월간 열쇠로 데일리 불가
        r = await cl.get("/briefings/monthly", params={"month": month}, headers=H)
        assert r.status_code == 200 and r.json()["status"] == "ready"
        assert (await cl.get("/briefings/monthly", params={"month": "2026-13"}, headers=H)).status_code == 422
        assert (await cl.get("/briefings/monthly", params={"month": "2020-01"}, headers=H)).status_code == 404
        lst = (await cl.get("/briefings/monthly/list", headers=H)).json()
        assert lst[0]["month"] == month and lst[0]["article_count"] == 4
        d = (await cl.get(f"/companies/{a_id}/digests", headers=H)).json()
        assert d[0]["month"] == month and d[0]["summary"]
        r = await cl.post(f"/briefings/monthly/{mb_id}/hold", headers=H, json={"reason": "내용 확인"})
        assert r.json()["status"] == "held" and r.json()["hold_reason"] == "내용 확인"

        # 보류 중엔 배치가 보내지 않는다
        async with AsyncSessionLocal() as db:
            await settings_store.set_value(db, config.BRIEFING_ENABLED, "1")
            await db.commit()
            assert "held" in await sender.send_monthly(db, date(2026, 9, 1))
        r = await cl.post(f"/briefings/monthly/{mb_id}/release", headers=H)
        assert r.json()["status"] == "ready" and r.json()["approved_by"] == admin_id

        sent.clear()
        r = await cl.post(f"/briefings/monthly/{mb_id}/test-send", headers=H)
        assert r.status_code == 200 and sent[0]["to"] == "010-1111-2222" and "/m/monthly?t=" in sent[0]["text"], r.text
        async with AsyncSessionLocal() as db:
            mb = await db.get(MonthlyBriefing, mb_id)
            assert mb.status == "ready"  # 테스트 발송은 상태를 바꾸지 않음

        # 배치 조건: 주말(9/5 토)엔 안 보내고, 11일 이후엔 자동 발송하지 않음
        async with AsyncSessionLocal() as db:
            assert (await sender.send_monthly(db, date(2026, 9, 5)))["skipped"] == "영업일이 아님"
            assert "10일" in (await sender.send_monthly(db, date(2026, 9, 14)))["skipped"]
            await settings_store.set_value(db, config.MONTHLY_ENABLED, "0")
            await db.commit()
            assert (await sender.send_monthly(db, date(2026, 9, 1)))["skipped"] == "월간 발송 꺼짐"
            await settings_store.set_value(db, config.MONTHLY_ENABLED, "1")
            await db.commit()
            sent.clear()
            r = await sender.send_monthly(db, date(2026, 9, 1))
            assert r["success"] and r["month"] == month and len(sent) == 1, r
            assert (await sender.send_monthly(db, date(2026, 9, 2)))["skipped"] == "이미 발송됨"
        assert (await cl.post("/briefings/monthly/build", headers=H, json={"month": month})).status_code == 409  # 발송 후 재작성 불가

    # ---- 검토에서 대부분 삭제되면 보류(held)
    state["remove_all"] = True
    async with AsyncSessionLocal() as db:
        r = await monthly.build_monthly(db, "2026-07", force=True)
    assert r["status"] == "held" and "30%" in r["reason"], r
    async with AsyncSessionLocal() as db:
        assert "held" in await sender.send_monthly(db, date(2026, 8, 3))


def test_monthly(monkeypatch):
    asyncio.run(_run(monkeypatch))
