"""반기 기업 종합보고서 작성(P4-5·P4-6) — AI 호출은 가짜로 바꿔 흐름 전체를 시험한다."""
import io
import uuid
from datetime import date, datetime

import pytest

from app.services.company_report import half_year as hy


def test_period_helpers():
    assert hy.period_text(2026, 1) == "2026.01.01 ~ 2026.06.30" and hy.period_text(2026, 2) == "2026.07.01 ~ 2026.12.31"
    assert hy.half_range(2026, 1) == (date(2026, 1, 1), date(2026, 6, 30))
    assert hy.half_range(2026, 2) == (date(2026, 7, 1), date(2026, 12, 31))
    assert hy.half_label(2026, 2) == "2026년 하반기"
    assert hy.half_months(2026, 2)[0] == "2026-07" and len(hy.half_months(2026, 1)) == 6
    assert hy.prev_half(2026, 1) == (2025, 2) and hy.prev_half(2026, 2) == (2026, 1)
    assert hy.latest_closed_half(date(2026, 10, 1)) == (2026, 1)
    assert hy.latest_closed_half(date(2027, 1, 31)) == (2026, 2)


RAW = {
    "summary": {"three_lines": [{"text": "시리즈B 150억 원을 유치했다.", "source_ids": ["R2"]}, "출처 없는 문장"],
                "changes": [{"text": "지난 보고서 이후 유럽 인증을 받았다.", "source_ids": ["F1"]}],
                "stage": "매출 발생", "stage_note": {"text": "제품 매출이 나오는 단계다.", "source_ids": ["D1"]}},
    "sections": [
        {"no": 1, "blocks": [{"type": "table", "columns": ["항목", "내용"], "rows": [
            {"cells": ["정식 기업명", "테스트바이오"], "source_ids": ["P1"]},
            {"cells": ["자본금", "공개 자료 없음"], "source_ids": []}]}]},
        {"no": 3, "blocks": [{"type": "para", "items": [{"text": "체외진단 기업이다.", "source_ids": ["P1"], "kind": "analysis"}]}]},
        {"no": 5, "blocks": [{"type": "para", "items": [{"text": "후속 투자는 신뢰의 신호로 볼 수 있다.", "source_ids": ["R2"], "kind": "analysis"}]}]},
        {"no": 8, "blocks": [{"type": "timeline", "items": [{"date": "2026-03", "text": "시리즈B 유치", "source_ids": ["M1"]},
                                                              {"date": "2026-05", "text": "신제품 출시", "source_ids": ["M2"]}]}]},
        {"no": 10, "blocks": [{"type": "para", "items": [{"text": "이번 반기 진전이 뚜렷했다.", "source_ids": ["R2", "M2"], "kind": "analysis"}]}]},
        {"no": 99, "blocks": []},
    ],
    "financials": {"unit": "억 원", "years": [2023, 2024, 2025], "series": {"매출액": [45, 90, 120], "영업이익": [-12, "5", None]}},
    "glossary": [{"term": "시리즈B", "desc": "사업을 키우는 단계의 투자"}],
}


def test_normalize_flatten_apply():
    c = hy.normalize(RAW)
    assert [s["no"] for s in c["sections"]] == list(range(1, 11))
    # 11번(기간 이후 주요 사항)은 내용이 있을 때만
    c11 = hy.normalize({**RAW, "sections": RAW["sections"] + [{"no": 11, "blocks": [{"type": "para", "items": [
        {"text": "2026년 9월 시리즈C 300억 원을 유치했다.", "source_ids": ["N1"]}]}]}]})
    assert c11["sections"][-1]["no"] == 11 and c11["sections"][-1]["title"] == "기간 이후 주요 사항"
    assert len(c["summary"]["three_lines"]) == 2 and c["summary"]["three_lines"][1]["source_ids"] == []
    # 분석 표시는 5·7·10번에서만
    sec3 = c["sections"][2]["blocks"][0]["items"][0]
    assert sec3["kind"] == "fact"
    assert c["sections"][4]["blocks"][0]["items"][0]["kind"] == "analysis"
    flat = hy.flatten(c)
    ids = [s["id"] for s in flat]
    assert len(ids) == len(set(ids))
    # 출처 없는 표 행('공개 자료 없음')은 검토에 보내지 않는다
    assert not any("자본금" in s["text"] for s in flat)
    row = next(s for s in flat if "정식 기업명" in s["text"])
    assert row["is_row"] and row["text"] == "항목: 정식 기업명 | 내용: 테스트바이오"
    tl = next(s for s in flat if "신제품" in s["text"])
    assert tl["text"] == "2026-05 신제품 출시"
    # 검토 결과 되돌리기: 문장 고침·삭제·불합의, 표 행 고침은 note
    s_first = c["summary"]["three_lines"][0]["id"]
    kept = [{"id": s_first, "text": "시리즈B 150억 원을 유치했다(2026년 3월).", "source_ids": ["R2"]},
            {"id": row["id"], "text": "항목: 정식 기업명 | 내용: (주)테스트바이오", "source_ids": ["P1"]},
            {"id": tl["id"], "text": "2026-05 신제품 TB-200 출시", "source_ids": ["M2"], "disputed": True, "review1_issue": "날짜 확인"}]
    removed = [{"id": c["sections"][9]["blocks"][0]["items"][0]["id"], "reason": "근거 부족"}]
    out = hy.apply_review(c, kept, removed)
    assert out["summary"]["three_lines"][0]["text"].endswith("(2026년 3월).")
    t_rows = out["sections"][0]["blocks"][0]["rows"]
    assert t_rows[0]["cells"] == ["정식 기업명", "테스트바이오"] and t_rows[0]["disputed"] and "(주)테스트바이오" in t_rows[0]["review_note"]
    assert t_rows[1]["cells"][1] == "공개 자료 없음"
    items = out["sections"][7]["blocks"][0]["items"]
    assert items[1]["text"] == "신제품 TB-200 출시" and items[1]["disputed"] and items[1]["review_note"] == "날짜 확인"
    assert out["sections"][9]["blocks"] == []  # 결론 문장이 지워져 블록도 빠짐


def test_fin_series_cleans_values():
    years, series, unit = hy._fin_series(RAW["financials"])
    assert years == [2023, 2024, 2025] and series["영업이익"] == [-12.0, 5.0, None] and unit == "억 원"


# --------------------------------------------------------------------------- 전체 흐름(실제 DB)

from tests.test_permissions import PG, env  # noqa: E402,F401


def _png() -> bytes:
    from PIL import Image

    b = io.BytesIO()
    Image.new("RGB", (500, 320), (20, 120, 90)).save(b, "PNG")
    return b.getvalue()


@pytest.mark.skipif(not PG, reason="PERM_PG_URL 없음(실제 PostgreSQL 필요)")
async def test_full_report_flow(env, monkeypatch, tmp_path):  # noqa: F811
    from sqlalchemy import select

    from app.models.company_report import (
        CompanyDocument, CompanyFact, CompanyFundingRound, CompanyMonthlyDigest, CompanyReport, ReportImage,
    )
    from app.models.news_briefing import AIReviewLog, NewsArticle, PortfolioCompany
    from app.services import llm_client
    from app.services.company_report import storage

    monkeypatch.setenv("COMPANY_DB_ROOT", str(tmp_path))
    c, d, hdr = env["c"], env["d"], env["hdr"]
    ha, hb, ho = hdr(d["A"]), hdr(d["B"]), hdr(d["owner"])
    co = (await c.post("/company-report/companies", headers=ha, json={"name": f"반기-{uuid.uuid4().hex[:6]}", "ceo_name": "홍길동",
                                                                      "backfill_months": 0})).json()
    cid = co["id"]
    img_key = storage.make_key(cid, "docimg", "x1", "png")
    storage.save_bytes(img_key, _png())
    async with env["Session"]() as db:
        db.add_all([
            CompanyFact(company_id=cid, fact_type="certification", fact_date=date(2026, 1, 20), title="유럽 CE 인증 획득", status="confirmed",
                        source_refs=[{"url": "https://news.example/ce", "title": "CE 인증"}]),
            CompanyFact(company_id=cid, fact_type="contract", fact_date=date(2026, 4, 2), title="대형 병원 3곳 공급 계약", status="candidate"),
            CompanyFundingRound(company_id=cid, round_date=date(2023, 5, 1), round_name="시리즈A", amount=3_000_000_000, status="confirmed",
                                investors=[{"name": "한빛벤처스", "type": "VC", "lead": True}]),
            CompanyFundingRound(company_id=cid, round_date=date(2026, 3, 10), round_name="시리즈B", amount=15_000_000_000, status="confirmed",
                                investors=[{"name": "한빛벤처스", "type": "VC"}], is_follow_on=True,
                                source_refs=[{"url": "https://news.example/b", "title": "시리즈B"}]),
            CompanyMonthlyDigest(company_id=cid, month="2026-03", summary="시리즈B 유치", content={"facts": [{"text": "150억 유치"}]}),
            CompanyMonthlyDigest(company_id=cid, month="2026-05", summary="신제품 출시"),
            NewsArticle(company_id=cid, url="https://news.example/1", url_hash=uuid.uuid4().hex, title="테스트바이오 시리즈B 150억",
                        press="경제신문", published_at=datetime(2026, 3, 11, 9), summary="150억 유치", relevance_score=90, tag="positive"),
            NewsArticle(company_id=cid, url="https://news.example/2", url_hash=uuid.uuid4().hex, title="신제품 TB-200 출시",
                        press="IT신문", published_at=datetime(2026, 5, 3, 9), relevance_score=70),
            NewsArticle(company_id=cid, url="https://dart.example/1", url_hash=uuid.uuid4().hex, title="주요사항보고서", source_type="dart",
                        source="dart", published_at=datetime(2026, 2, 1, 9)),
            NewsArticle(company_id=cid, url="https://news.example/old", url_hash=uuid.uuid4().hex, title="작년 기사",
                        published_at=datetime(2025, 9, 1, 9)),
            # 반기(1/1~6/30) 이후 일 — 본문(1~10)에 섞이지 않고 'N' 출처(11번 기간 이후 주요 사항)로만(2026-10-08)
            CompanyFact(company_id=cid, fact_type="contract", fact_date=date(2026, 8, 15), title="8월 미국 수출 계약", status="confirmed"),
            CompanyFundingRound(company_id=cid, round_date=date(2026, 9, 1), round_name="시리즈C", amount=30_000_000_000, status="confirmed"),
            NewsArticle(company_id=cid, url="https://news.example/later", url_hash=uuid.uuid4().hex, title="9월 시리즈C 300억",
                        press="경제신문", published_at=datetime(2026, 9, 2, 9), relevance_score=80, tag="positive"),
        ])
        await db.flush()
        from app.models.company_report import CompanyFile

        f = CompanyFile(company_id=cid, folder="docs", display_name="IR.pdf", storage_key="x", file_type="pdf", size=1)
        db.add(f)
        await db.flush()
        f2 = CompanyFile(company_id=cid, folder="docs", display_name="9월IR.pdf", storage_key="y", file_type="pdf", size=1)
        db.add(f2)
        await db.flush()
        db.add(CompanyDocument(company_id=cid, file_id=f2.id, filename="9월IR.pdf", file_type="pdf", extract_status="done",
                               extracted_text="9월 기준 자료", doc_date=date(2026, 9, 10), doc_date_source="ai", ai_memo="9월 IR"))
        db.add(CompanyDocument(company_id=cid, file_id=f.id, filename="IR자료.pdf", file_type="pdf", extract_status="done",
                               doc_date=date(2026, 5, 1), doc_date_source="ai",
                               extracted_text="2025년 매출 120억 원", doc_type="ir", ai_memo="IR 자료", ai_facts=["매출 120억"],
                               extracted_images=[{"key": img_key, "ext": "png", "page": 3, "width": 500, "height": 320}]))
        await db.commit()

    calls = {"web": 0, "draft": None, "review1": 0, "review2": 0, "images": 0, "sales": 0}

    async def fake_text(key, prompt, **kw):
        calls["web"] += 1
        assert kw.get("web_search") is True
        return llm_client.LLMResult(text='{"facts": [{"topic": "대표자", "text": "홍길동 대표는 서울대 출신이다.", "url": "https://web.example/ceo", "title": "인터뷰"},'
                                         ' {"topic": "기타", "text": "주소 없는 사실"}]}')

    async def fake_json(key, prompt, **kw):
        st = kw.get("stage")
        if st == "report_draft":
            calls["draft"] = prompt
            return llm_client.LLMResult(text="", data={
                "summary": {"three_lines": [{"text": "시리즈B 150억 원을 유치했다.", "source_ids": ["R2"]}],
                            "changes": [{"text": "첫 보고서다.", "source_ids": ["P1"]}], "stage": "매출 발생",
                            "stage_note": {"text": "매출이 나오는 단계다.", "source_ids": ["D1"]}},
                "sections": [
                    {"no": 1, "blocks": [{"type": "table", "columns": ["항목", "내용"],
                                          "rows": [{"cells": ["대표자", "홍길동"], "source_ids": ["P1", "W1"]}]}]},
                    {"no": 5, "blocks": [{"type": "para", "items": [{"text": "누적 투자금은 180억 원이다.", "source_ids": ["R1", "R2"]},
                                                                     {"text": "기존 투자사의 후속 투자다.", "source_ids": ["R2"], "kind": "analysis"}]}]},
                    {"no": 6, "blocks": [{"type": "table", "columns": ["날짜", "성과", "수치"],
                                          "rows": [{"cells": ["2026-01", "유럽 CE 인증", ""], "source_ids": ["F1"]}]}]},
                    {"no": 8, "blocks": [{"type": "timeline", "items": [{"date": "2026-03", "text": "시리즈B 유치", "source_ids": ["M1"]},
                                                                          {"date": "2026-05", "text": "신제품 출시", "source_ids": ["M2", "A2"]}]}]},
                    {"no": 9, "blocks": [{"type": "para", "items": [{"text": "2025년 매출은 120억 원이다.", "source_ids": ["D1"]}]}]},
                    {"no": 10, "blocks": [{"type": "para", "items": [{"text": "곧 상장할 것이다.", "source_ids": ["A1"], "kind": "analysis"},
                                                                      {"text": "인증과 투자로 기반을 다졌다.", "source_ids": ["F1", "R2"], "kind": "analysis"}]}]},
                ],
                "financials": {"unit": "억 원", "years": [2024, 2025], "series": {"매출액": [90, 120]}},
                "glossary": [{"term": "CE 인증", "desc": "유럽 판매 허가 표시"}],
            })
        if st == "review2":
            calls["review2"] += 1
            # '곧 상장' 문장은 지우고, 나머지는 유지
            import re as _re

            ids = _re.findall(r"\[(s\d+)\]", prompt) or _re.findall(r'"id": "(s\d+)"', prompt)
            final = []
            for sid in set(ids):
                final.append({"id": sid, "decision": "keep", "source_ids": [], "reason": ""})
            for line in prompt.splitlines():
                if "곧 상장" in line:
                    m = _re.search(r"(s\d+)", line)
                    if m:
                        final = [x for x in final if x["id"] != m.group(1)] + [{"id": m.group(1), "decision": "remove", "reason": "상장 보장 표현"}]
            return llm_client.LLMResult(text="", data={"final": final})
        if st == "report_sales":
            calls["sales"] += 1
            return llm_client.LLMResult(text="", data={"key_messages": ["150억 유치", "CE 인증", "매출 120억"],
                                                       "qa": [{"q": "상장은 언제?", "a": "회사가 정하지 않았습니다."}],
                                                       "careful": ["'곧 상장' 금지"]})
        raise AssertionError(f"예상하지 못한 호출: {st}")

    async def fake_gemini(key, prompt, **kw):
        calls["review1"] += 1
        assert kw.get("grounding") is True
        import re as _re

        reviews = []
        for line in prompt.splitlines():
            if "신제품 출시" in line:
                m = _re.search(r"(s\d+)", line)
                if m:
                    reviews.append({"id": m.group(1), "verdict": "remove", "issue": "출시 날짜가 출처와 다름"})
        return llm_client.LLMResult(text="", data={"reviews": reviews, "missing": []})

    async def fake_images(key, images, prompt, **kw):
        calls["images"] += 1
        assert len(images) == 1 and images[0][1] == "image/jpeg"
        return llm_client.LLMResult(text="", data={"selected": [{"image": 1, "section_no": 4, "caption": "TB-100 제품 사진"}]})

    async def fake_key(db, provider, user_id=None):
        return ("k-" + provider, "")

    monkeypatch.setattr(llm_client, "claude_text", fake_text)
    monkeypatch.setattr(llm_client, "claude_json", fake_json)
    monkeypatch.setattr(llm_client, "gemini_json", fake_gemini)
    monkeypatch.setattr(llm_client, "claude_images_json", fake_images)
    monkeypatch.setattr(hy, "get_service_key", fake_key)

    # DART 재무제표(2026-10-08): 고유번호가 있는 기업은 사업보고서 주요 계정을 S 출처로
    from app.services.collectors import dart_client

    async def fake_statements(self, corp_code, years):
        assert corp_code == "00999999" and years == [2025, 2024]
        return {"year": 2025, "fs": "연결", "rcept_no": "20260320000123", "periods": ["제 9 기", "제 8 기", "제 7 기"],
                "accounts": {"매출액": [12_000_000_000.0, 9_000_000_000.0, 4_500_000_000.0], "영업이익": [1_500_000_000.0, None, -1_200_000_000.0]}}

    monkeypatch.setattr(dart_client.DARTClient, "get_statements", fake_statements)
    async with env["Session"]() as db:
        (await db.get(PortfolioCompany, cid)).corp_code = "00999999"
        await db.commit()

    # 목록에 없는 매니저는 못 만든다
    assert (await c.post(f"/company-report/companies/{cid}/reports", headers=hb, json={"year": 2026, "half": 1})).status_code == 404
    assert (await c.post(f"/company-report/companies/{cid}/reports", headers=ha, json={"year": 2026})).status_code == 422
    assert (await c.post(f"/company-report/companies/{cid}/reports", headers=ha, json={"year": 2030, "half": 1})).status_code == 422

    async with env["Session"]() as db:
        co_obj = await db.get(PortfolioCompany, cid)
        r = await hy.create_report(db, cid, 2026, 1, d["A"])
        assert r.status == "generating" and r.version == 1
        out = await hy.run_report(db, r.id)
        assert out.status == "draft", out.error
        rid = r.id
        # 수집: 이번 반기 기사만(작년 기사 제외), DART 는 따로, 웹 사실은 주소 있는 것만
        assert "작년 기사" not in calls["draft"] and "주소 없는 사실" not in calls["draft"]
        assert "[W1] 웹 확인(대표자) 홍길동 대표는 서울대 출신이다." in calls["draft"]
        assert "[D1] 자료함 문서 'IR자료.pdf'" in calls["draft"] and "[A3] DART 공시" in calls["draft"]
        # 기간 규칙: 대상 기간 표시, 반기 이후 일은 N 출처로만(본문 출처 F·R·D·A 에는 없음)
        assert "대상 기간은 2026.01.01 ~ 2026.06.30" in calls["draft"]
        assert "[S1] DART 사업보고서 재무제표(연결, 2025사업연도" in calls["draft"] and "매출액: 제 9 기 120.0억 원" in calls["draft"]
        assert out.content["stats"]["dart_statement"]  # (S1 은 초안이 인용하지 않아 부록 출처에는 없음)
        # 오늘 등록한 기업이라 1~6월은 수집 기록이 없다 → 보고서에 남긴다(보완 없이 만든 경우)
        assert out.content["stats"]["coverage"]["missing_months"] == hy.half_months(2026, 1)
        body_src = "\n".join(l for l in calls["draft"].splitlines() if l[:2] in ("[F", "[R", "[D", "[A"))
        assert "8월 미국 수출" not in body_src and "시리즈C" not in body_src and "9월IR" not in body_src
        assert "[N1] 기간 이후 원장 사실" in calls["draft"] and "기간 이후 투자유치(2026-09-01) 시리즈C" in calls["draft"]
        assert "기간 이후 기사(2026-09-02" in calls["draft"] and "기간 이후 자료함 문서 '9월IR.pdf'" in calls["draft"]
        cont = out.content
        # 2차 검토가 '곧 상장' 문장을 지움, 1차만 지우자고 한 문장은 불합의로 남김
        concl = [s["text"] for blk in cont["sections"][9]["blocks"] for s in blk["items"]]
        assert concl == ["인증과 투자로 기반을 다졌다."]
        tl = cont["sections"][7]["blocks"][0]["items"]
        assert tl[1]["text"] == "신제품 출시" and tl[1]["disputed"] is True and "날짜" in tl[1]["review_note"]
        assert out.review["summary"]["removed"] == 1 and out.review["summary"]["disputed"] == 1
        # 부록: 인용 순서대로 번호, 비공개 자료는 링크 없음
        cit = cont["appendix"]["citations"]
        assert cit[0]["id"] == "R2" and cit[0]["no"] == 1 and cit[0]["url"] == "https://news.example/b"
        assert out.sources["D1"]["url"] is None and out.sources["W1"]["url"] == "https://web.example/ceo"
        assert [a["title"] for a in cont["appendix"]["articles"]] == ["테스트바이오 시리즈B 150억", "신제품 TB-200 출시"]
        assert cont["appendix"]["dart"][0]["title"] == "주요사항보고서" and cont["appendix"]["disclaimer"]
        assert cont["cover"]["period_range"] == "2026.01.01 ~ 2026.06.30"
        assert [s["no"] for s in cont["sections"]][-1] == 10  # 초안에 11번 내용이 없으면 항목을 넣지 않는다
        assert cont["cover"]["period"] == "2026년 상반기" and out.sales_note["key_messages"][0] == "150억 유치"
        # 이미지: 차트 2(투자유치·재무) + 자료 그림 1(선택)
        imgs = (await db.execute(select(ReportImage).where(ReportImage.report_id == rid).order_by(ReportImage.sort_order))).scalars().all()
        assert [(i.kind, i.section_no, i.selected) for i in imgs] == [("chart", 5, True), ("chart", 9, True), ("document", 4, True)]
        assert imgs[2].caption == "TB-100 제품 사진" and imgs[2].rights_note
        assert all(storage.exists(i.storage_key) for i in imgs)
        logs = (await db.execute(select(AIReviewLog.stage).where(AIReviewLog.target_id == rid))).scalars().all()
        assert "draft" in logs and "review1" in logs and "review2" in logs
    assert calls["web"] == 1 and calls["images"] == 1 and calls["sales"] == 1 and calls["review1"] >= 2

    # API: 목록·본문·그림, 목록에 없는 매니저는 못 봄
    lst = (await c.get(f"/company-report/companies/{cid}/reports", headers=ha)).json()
    assert lst[0]["id"] == rid and lst[0]["period_label"] == "2026년 상반기" and lst[0]["status"] == "draft"
    full = (await c.get(f"/company-report/reports/{rid}", headers=ha)).json()
    assert full["content"]["summary"]["stage"] == "매출 발생" and len(full["images"]) == 3
    assert (await c.get(f"/company-report/report-images/{full['images'][0]['id']}/file", headers=ha)).headers["content-type"] == "image/png"
    assert (await c.get(f"/company-report/reports/{rid}", headers=hb)).status_code == 404
    assert (await c.get(f"/company-report/reports/{rid}", headers=ho)).status_code == 200
    # 만드는 중이면 중복 생성 막기
    async with env["Session"]() as db:
        r2 = await hy.create_report(db, cid, 2026, 1, d["A"])
        assert r2.version == 2
    assert (await c.post(f"/company-report/companies/{cid}/reports", headers=ha, json={"year": 2026, "half": 1})).status_code == 409


@pytest.mark.skipif(not PG, reason="PERM_PG_URL 없음(실제 PostgreSQL 필요)")
async def test_report_fails_cleanly_without_key(env, monkeypatch, tmp_path):  # noqa: F811
    monkeypatch.setenv("COMPANY_DB_ROOT", str(tmp_path))

    async def no_key(db, provider, user_id=None):
        return None

    monkeypatch.setattr(hy, "get_service_key", no_key)
    c, d, hdr = env["c"], env["d"], env["hdr"]
    co = (await c.post("/company-report/companies", headers=hdr(d["A"]), json={"name": f"키없음-{uuid.uuid4().hex[:6]}",
                                                                               "backfill_months": 0})).json()
    async with env["Session"]() as db:
        r = await hy.create_report(db, co["id"], 2026, 1, d["A"])
        out = await hy.run_report(db, r.id)
        assert out.status == "failed" and "Claude 키" in out.error



def test_dart_statement_parse_and_text():
    from app.services.collectors.dart_client import parse_statement

    rows = [{"account_nm": "매출액", "thstrm_amount": "12,000,000,000", "frmtrm_amount": "9000000000", "bfefrmtrm_amount": "",
             "thstrm_nm": "제 9 기", "frmtrm_nm": "제 8 기", "bfefrmtrm_nm": "제 7 기", "rcept_no": "R1"},
            {"account_nm": "영업 이익", "thstrm_amount": "-300000000", "frmtrm_amount": "100000000"},
            {"account_nm": "기타", "thstrm_amount": "1"}]
    st = parse_statement(rows)
    assert st["rcept_no"] == "R1" and st["periods"][0] == "제 9 기"
    assert st["accounts"]["매출액"] == [12e9, 9e9, None] and st["accounts"]["영업이익"][0] == -3e8 and "기타" not in st["accounts"]
    txt = hy.statement_text({"year": 2025, "fs": "별도", **st})
    assert "2025사업연도" in txt and "매출액: 제 9 기 120.0억 원, 제 8 기 90.0억 원" in txt and "영업이익: 제 9 기 -3.0억 원" in txt


def test_uncovered_days():
    from app.services.company_report.report_prep import uncovered_days

    gaps = uncovered_days(date(2026, 1, 1), date(2026, 1, 10), [(date(2026, 1, 3), date(2026, 1, 5)), (date(2026, 1, 8), date(2026, 3, 1))])
    assert gaps == [date(2026, 1, 1), date(2026, 1, 2), date(2026, 1, 6), date(2026, 1, 7)]


@pytest.mark.skipif(not PG, reason="PERM_PG_URL 없음(실제 PostgreSQL 필요)")
async def test_report_coverage_and_fill(env, monkeypatch):  # noqa: F811
    """[보고서 만들기] 전 점검(2026-10-08): 등록 전 기간·월간 요약이 비면 알려 주고, 보완하면 채운다."""
    from app.models.company_report import CompanyMonthlyDigest
    from app.models.news_briefing import BackfillJob, PortfolioCompany
    from app.services.company_report import backfill, half_year, monthly, report_prep

    c, d, hdr = env["c"], env["d"], env["hdr"]
    ha, hb = hdr(d["A"]), hdr(d["B"])
    cid = (await c.post("/company-report/companies", headers=ha, json={"name": f"점검-{uuid.uuid4().hex[:6]}",
                                                                       "backfill_months": 0})).json()["id"]
    url = f"/company-report/companies/{cid}/reports/coverage"
    assert (await c.get(url, headers=hb, params={"year": 2026, "half": 1})).status_code == 404
    cov = (await c.get(url, headers=ha, params={"year": 2026, "half": 1})).json()
    assert not cov["ok"] and cov["gap_from"] == "2026-01-01" and cov["gap_to"] == "2026-06-30"
    assert cov["missing_months"] == half_year.half_months(2026, 1) and cov["missing_digests"] == half_year.half_months(2026, 1)

    # 보완: 과거 데이터 구축(가짜 — 끝난 작업만 남김) → 빠진 달 월간 요약(Claude 키 없음 → 빈 요약으로 표시만)
    called = {}

    async def fake_backfill(db, company_id, *, date_from=None, date_to=None, trigger="manual", user_id=None, with_ai_checks=True, **kw):
        called["range"] = (date_from, date_to, trigger, with_ai_checks)
        db.add(BackfillJob(company_id=company_id, period_from=date_from, period_to=date_to, trigger=trigger, status="done", progress=100))
        await db.commit()
        return {"verdict": "sufficient"}

    async def no_key(db, provider, user_id=None):
        return None

    monkeypatch.setattr(backfill, "run_backfill", fake_backfill)
    monkeypatch.setattr(monthly, "get_service_key", no_key)
    async with env["Session"]() as db:
        co = await db.get(PortfolioCompany, cid)
        out = await report_prep.fill(db, co, 2026, 1, d["A"])
        assert called["range"] == (date(2026, 1, 1), date(2026, 6, 30), "report", False) and not out["errors"]
        assert out["digests"]["built"] == 6
        from sqlalchemy import select

        n = (await db.execute(select(CompanyMonthlyDigest).where(CompanyMonthlyDigest.company_id == cid))).scalars().all()
        assert len(n) == 6
    cov = (await c.get(url, headers=ha, params={"year": 2026, "half": 1})).json()
    assert cov["ok"] and all(m["collected"] and m["digest"] for m in cov["months"])

    # [보완 수집 후 만들기] → 백그라운드 작성에 prepare=True
    seen = {}

    async def fake_bg(rid, prepare=False):
        seen["prepare"] = prepare

    monkeypatch.setattr(half_year, "run_in_background", fake_bg)
    r = await c.post(f"/company-report/companies/{cid}/reports", headers=ha, json={"year": 2026, "half": 1, "fill_gaps": True})
    assert r.status_code == 202 and seen["prepare"] is True
