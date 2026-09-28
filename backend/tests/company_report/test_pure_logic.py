"""기업 리포트 순수 로직 테스트(DB·네트워크 없음)."""
from datetime import date, datetime
from types import SimpleNamespace

from app.services.collectors.data_go_kr import summarize_forecast
from app.services.collectors.market_indices import pick_previous
from app.services.company_report import cross_review, daily, sender, summarizer
from app.services.company_report.dedup import group_similar, normalize_url, relevance, url_hash


# ---------------------------------------------------------------- dedup
def test_normalize_url_drops_tracking():
    a = normalize_url("https://news.example.com/a?id=1&utm_source=x#top")
    b = normalize_url("https://news.example.com/a?id=1")
    assert a == b
    assert url_hash("https://news.example.com/a?id=1&utm_source=x") == url_hash("https://news.example.com/a?id=1")


def test_relevance_exclude_and_score():
    r = relevance("뉴로리온, 시리즈A 유치", "뉴로리온 홍길동 대표", ["뉴로리온"], ["홍길동"], [])
    assert not r.excluded and r.score >= 60
    x = relevance("뉴로리온 아파트 분양", "", ["뉴로리온"], [], ["아파트"])
    assert x.excluded and x.score == 0


def test_group_similar():
    arts = [{"title": "뉴로리온 50억 투자 유치"}, {"title": "뉴로리온, 50억 투자유치"}, {"title": "전혀 다른 기사 제목입니다"}]
    groups = group_similar(arts)
    assert any(len(g) == 2 for g in groups)


# ---------------------------------------------------------------- cross review
def _s(i, src=("A1",)):
    return {"id": i, "section": "overall", "text": f"문장{i}", "source_ids": list(src)}


def test_merge_remove_fix_dispute():
    sentences = [_s("o1"), _s("o2"), _s("o3"), _s("o4", ())]
    r1 = {"reviews": [{"id": "o3", "verdict": "remove", "issue": "과장"}]}
    r2 = {"final": [
        {"id": "o1", "decision": "remove", "reason": "근거 불일치"},
        {"id": "o2", "decision": "fix", "final_text": "고친 문장"},
        {"id": "o3", "decision": "keep"},
        {"id": "o4", "decision": "keep"},
    ]}
    out = cross_review.merge_reviews(sentences, r1, r2, "briefing")
    assert [s["id"] for s in out.sentences] == ["o2"]
    assert out.sentences[0]["text"] == "고친 문장"
    assert len(out.disputed) == 1
    assert out.summary["removed"] == 3

    rep = cross_review.merge_reviews(sentences, r1, r2, "report")
    assert any(s.get("disputed") for s in rep.sentences)


# ---------------------------------------------------------------- 지수·날씨
def test_pick_previous_skips_today_and_holidays():
    rows = [
        {"date": date(2026, 9, 24), "open": 1.0, "close": 100.0},
        {"date": date(2026, 9, 25), "open": 101.0, "close": 102.0},
        {"date": date(2026, 9, 28), "open": 1.0, "close": 1.0},
    ]
    p = pick_previous(rows, date(2026, 9, 28))
    assert p["trade_date"] == "2026-09-25" and p["change"] == 2.0 and p["change_pct"] == 2.0
    assert pick_previous([], date(2026, 9, 28)) is None


def test_summarize_forecast():
    it = [
        {"fcstDate": "20260928", "fcstTime": "0900", "category": "SKY", "fcstValue": "1"},
        {"fcstDate": "20260928", "fcstTime": "0900", "category": "PTY", "fcstValue": "0"},
        {"fcstDate": "20260928", "fcstTime": "1500", "category": "PTY", "fcstValue": "1"},
        {"fcstDate": "20260928", "fcstTime": "0600", "category": "TMN", "fcstValue": "14.0"},
        {"fcstDate": "20260928", "fcstTime": "1500", "category": "TMX", "fcstValue": "25.0"},
        {"fcstDate": "20260928", "fcstTime": "1500", "category": "POP", "fcstValue": "60"},
    ]
    s = summarize_forecast(it, date(2026, 9, 28))
    assert s["tmin"] == 14.0 and s["tmax"] == 25.0 and s["sky_pm"] == "비" and "60%" in s["text"]


# ---------------------------------------------------------------- 요약 반영
def test_summarizer_apply_result_hides_low_relevance():
    a1 = SimpleNamespace(id="x1", relevance_score=80, source_type="news", summary=None, tag=None, issue_type=None,
                         summarized_at=None, is_hidden=False, hidden_at=None, hidden_by=None)
    a2 = SimpleNamespace(**{**a1.__dict__, "id": "x2"})
    n = summarizer.apply_result([a1, a2], [
        {"id": "x1", "summary": "요약", "tag": "CAUTION", "issue_type": "소송", "relevance": 90},
        {"id": "x2", "summary": "동명 회사", "tag": "weird", "issue_type": "없음", "relevance": 10},
        {"id": "nope", "summary": "무시"},
    ])
    assert n == 2
    assert a1.tag == "caution" and a1.issue_type == "소송" and not a1.is_hidden
    assert a2.tag == "neutral" and a2.issue_type == "기타" and a2.is_hidden and a2.hidden_by == "ai"


# ---------------------------------------------------------------- 데일리 묶기·폴백·알림톡 변수
def _art(i, cid, tag, rel=50):
    return SimpleNamespace(id=i, company_id=cid, tag=tag, relevance_score=rel, published_at=datetime(2026, 9, 27, 10),
                           title=f"제목{i}", url=f"https://n/{i}", press="언론", source_type="news",
                           summary=f"요약{i}", issue_type="기타")


def test_group_and_fallback():
    comps = {"c1": SimpleNamespace(name="가나"), "c2": SimpleNamespace(name="다라")}
    cards = daily.group_articles([_art("1", "c1", "neutral"), _art("2", "c2", "caution"), _art("3", "c1", "positive", 90)], comps)
    assert cards[0]["name"] == "다라"  # 주의 있는 기업이 먼저
    assert cards[1]["articles"][0]["id"] == "3"  # 호재가 중립보다 먼저
    overall, one = daily.fallback_content(cards)
    assert "주의 이슈는 1건" in overall[0]["text"] and any("[주의] 다라" in o["text"] for o in overall)
    assert one["c1"] == "요약3"
    srcs, mapping = daily.build_sources(cards)
    assert mapping[srcs[0]["id"]] == "2"


def test_template_b_variables_limits():
    b = SimpleNamespace(
        briefing_date=date(2026, 9, 28), article_count=12, caution_count=1, overall_summary="",
        basic_info={"weekday": "월", "company_with_news": 6, "weather": {"available": True, "text": "맑음, 14~25℃"},
                    "markets": [{"name": "S&P500", "market": "US", "available": True, "close": 5812.43, "change_pct": 0.41},
                                {"name": "코스피", "market": "KR", "available": False}]},
        review_summary={"overall": [{"text": "가" * 400}]},
        company_summaries=[{"name": f"기업{i}", "caution_count": int(i == 0), "one_liner": "한줄" * 30} for i in range(7)],
    )
    v = sender.template_b_variables(b)
    assert v["#{날짜}"] == "9/28(월)" and v["#{날짜코드}"] == "2026-09-28"
    assert len(v["#{종합브리핑}"]) <= 250 and len(v["#{기업별요약}"]) <= 400
    assert "S&P500 5,812.4(+0.4%)" in v["#{전일증시}"] and "코스피 조회실패" in v["#{전일증시}"]
    assert "[주의]" in v["#{기업별요약}"]
    assert "briefing?date=2026-09-28" in sender.render_text(b)


# ---------------------------------------------------------------- 공공데이터
def test_public_data_parsers():
    import httpx

    from app.services.collectors import public_data_clients as pdc

    xml = ("<response><header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header><body><items>"
           "<item><wkplNm>(주)테스트바이오</wkplNm><bzowrRgstNo>123456</bzowrRgstNo><seq>9</seq><wkplJnngStcd>1</wkplJnngStcd>"
           "<dataCrtYm>202608</dataCrtYm></item>"
           "<item><wkplNm>테스트바이오식당</wkplNm><bzowrRgstNo>999999</bzowrRgstNo><seq>10</seq></item>"
           "</items><totalCount>2</totalCount></body></response>")
    items, header = pdc.parse_items(httpx.Response(200, text=xml, headers={"content-type": "application/xml"}))
    assert len(items) == 2 and header["resultCode"] == "00" and header["totalCount"] == "2"
    assert pdc.pick_nps_workplace(items, "테스트바이오", "123-45-67890")["seq"] == "9"
    assert pdc.pick_nps_workplace(items, "테스트바이오", "555-55-55555") is None  # 사업자번호가 다르면 이름만 비슷해도 버림
    assert pdc.pick_nps_workplace(items, "(주)테스트바이오", None)["seq"] == "9"  # 정확한 이름 우선

    s = pdc.summarize_patents([
        {"applicantName": "주식회사 테스트바이오", "applicationDate": "20260301", "registerStatus": "등록", "inventionTitle": "A"},
        {"applicantName": "테스트바이오", "applicationDate": "20240101", "registerStatus": "공개", "inventionTitle": "B"},
        {"applicantName": "다른회사", "applicationDate": "20260301"},
    ], "테스트바이오", "2026-09-28")
    assert s["total"] == 2 and s["registered"] == 1 and s["applied_12m"] == 1 and s["recent"][0]["title"] == "A"
