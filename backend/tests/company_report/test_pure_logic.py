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
        company_summaries=[{"name": f"기업{i}", "caution_count": int(i == 0), "one_liner": "한줄" * 30} for i in range(12)],
    )
    v = sender.template_b_variables(b)
    assert v["#{날짜}"] == "9/28(월)" and v["#{날짜코드}"] == "2026-09-28"
    assert v["#{담당자명}"] == "사내" and v["#{날씨}"].startswith("서울 ")
    assert "S&P500 5,812.4(+0.4%)" in v["#{전일증시}"] and "코스피 조회실패" in v["#{전일증시}"]
    assert "[주의]" in v["#{기업별요약}"] and "외 " in v["#{기업별요약}"]
    t = sender.render_text(b, "김민호")
    assert t.startswith("[사내 업무용 메시지]\n김민호 담당자님,") and len(t) <= 1000
    assert t.endswith("아래 버튼에서 확인해 주세요.") and "#{" not in t  # 승인된 v1 문구 그대로


def test_mobile_link_token_and_lms():
    """버튼 주소의 #{날짜코드} 자리에 수신자별 열쇠값 → 폰 화면. 문자로 나갈 땐 본문 끝에 폰 화면 주소."""
    from app.services.company_report import mobile_link as ml

    rid = "3f2a9c1e-1111-4222-8333-444455556666"
    tok = ml.make("d", "2026-09-30", rid, today=date(2026, 9, 30))
    assert tok.startswith("2026-09-30." + rid + ".20261114.") and all(ch.isalnum() or ch in ".-_" for ch in tok)
    assert ml.parse("d", tok, today=date(2026, 10, 10)) == ("2026-09-30", rid)
    for bad in [tok[:-1] + ("A" if tok[-1] != "A" else "B"), tok.replace("09-30", "09-29"), "2026-09-30", ""]:
        try:
            ml.parse("d", bad, today=date(2026, 10, 1))
            raise AssertionError(bad)
        except ml.LinkError:
            pass
    try:
        ml.parse("d", tok, today=date(2026, 11, 15))  # 45일 지남
        raise AssertionError("expired")
    except ml.LinkError as e:
        assert "45일" in str(e)
    try:
        ml.parse("m", tok)  # 데일리 열쇠로 월간을 열 수 없다
        raise AssertionError("kind")
    except ml.LinkError:
        pass
    utok = ml.make("m", "2026-09", ml.subject_for(None, "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"))
    assert ml.parse("m", utok)[1].startswith("u")

    b = SimpleNamespace(
        briefing_date=date(2026, 9, 30), article_count=40, caution_count=1, overall_summary="",
        basic_info={"weekday": "수", "company_with_news": 10, "weather": {"available": True, "text": "맑음, 14~25℃, 강수확률 10%"},
                    "markets": [{"name": n, "market": mk, "available": True, "close": 5812.4, "change_pct": 0.4}
                                for n, mk in [("S&P500", "US"), ("나스닥", "US"), ("다우존스", "US"), ("코스피", "KR"), ("코스닥", "KR")]]},
        review_summary={"overall": [{"text": "문장 " + "가" * 90, "source_ids": []} for _ in range(5)]},
        company_summaries=[{"name": f"기업{i}", "caution_count": 0, "one_liner": "새 제품을 출시하고 대형 고객사와 공급 계약을 맺었다는 보도가 이어졌다"}
                           for i in range(10)],
    )
    t = SimpleNamespace(name="김민호", recipient_id=rid, user_id=None)
    token = sender.daily_token(b, t)
    v = sender.template_b_variables(b, "김민호", token)
    assert v["#{날짜코드}"] == token
    alim = sender.fill(sender.TEMPLATE_B, v)
    assert len(alim) <= 1000 and alim.endswith("아래 버튼에서 확인해 주세요.")
    lms = sender.render_text(b, "김민호", token)
    assert lms.endswith(f"https://working-hub.vercel.app/m/daily?t={token}") and "아래 버튼" not in lms
    assert len(lms) <= 1000 and len(lms.encode("euc-kr", errors="replace")) <= 2000


def test_mobile_daily_view_refs():
    """폰 화면: 문장마다 근거 기사 번호, 번호별 원문 주소(같은 기사는 같은 번호)."""
    from app.services.company_report import mobile_view
    from app.services.company_report.daily import build_sources

    cards = []
    for i in range(3):
        arts = [{"id": f"a{i}_{j}", "url": f"https://news.example.com/{i}/{j}", "title": f"기사 {i}-{j}", "press": "매체",
                 "summary": "s", "tag": "neutral", "issue_type": "제품", "source_type": "news", "published_at": "2026-09-29T08:00:00"} for j in range(4)]
        cards.append({"company_id": f"c{i}", "name": f"기업{i}", "caution_count": 0, "article_count": 4,
                      "one_liner": f"기업{i} 한 줄", "articles": arts[:3] + [{**a, "more": True} for a in arts[3:]]})
    _, mapping = build_sources(cards)
    rev = {v: k for k, v in mapping.items()}
    b = SimpleNamespace(
        briefing_date=date(2026, 9, 30), article_count=12, caution_count=0, overall_summary="", is_fallback=False,
        basic_info={"weekday": "수", "company_with_news": 3, "weather": {"available": True, "text": "맑음"}, "markets": []},
        review_summary={"overall": [{"text": "첫 문장", "source_ids": [rev["a1_0"], rev["a1_1"]]},
                                    {"text": "둘째 문장", "source_ids": [rev["a0_0"]]}], "source_map": mapping},
        company_summaries=cards,
    )
    v = mobile_view.daily_view(b)
    assert v["overall"][0] == {"text": "첫 문장", "refs": [1, 2]} and v["overall"][1]["refs"] == [3]
    assert v["companies"][1]["refs"] == [1]  # 기업1 대표 기사 = 이미 나온 [1]
    assert v["refs"][0] == {"n": 1, "url": "https://news.example.com/1/0", "title": "기사 1-0", "press": "매체", "date": "2026-09-29"}
    assert len(v["companies"][0]["articles"]) == 4 and v["weather"] == "서울 맑음"
    assert "review_summary" not in v and "source_map" not in str(v)


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


def test_usage_accumulate_and_price():
    from app.services import llm_client
    from app.services.company_report.usage import DEFAULT_PRICES, price_for

    llm_client.drain_usage()
    llm_client._record("claude-haiku-4-5", {"input_tokens": 1000, "output_tokens": 200})
    llm_client._record("claude-haiku-4-5", {"input_tokens": 500})
    got = llm_client.drain_usage()
    assert got == {"claude-haiku-4-5": {"calls": 2, "input": 1500, "output": 200}}
    assert llm_client.drain_usage() == {}
    assert price_for("gemini-3.1-pro-preview", DEFAULT_PRICES) == (2.0, 12.0)
    assert price_for("claude-opus-5", DEFAULT_PRICES) == (5.0, 25.0)


# ---------------------------------------------------------------- 국민연금 API 판(버전) 전환·키 가리기
def test_nps_variant_fallback_and_masking():
    import asyncio

    import httpx

    from app.services.collectors import public_data_clients as pdc

    ok_xml = ("<response><header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header>"
              "<body><items><item><seq>1</seq><wkplNm>에스에프에이</wkplNm><bzowrRgstNo>803810</bzowrRgstNo></item></items>"
              "</body></response>")
    seen = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(str(req.url))
        if not req.url.path.endswith("NpsBplcInfoInqireServiceV2/getBassInfoSearchV2") or "wkpl_nm" in req.url.params:
            return httpx.Response(400, text="Bad Request")
        assert "wkplNm" in req.url.params  # 첫 번째 판: ServiceV2 + V2 + camelCase
        return httpx.Response(200, text=ok_xml, headers={"content-type": "application/xml"})

    async def run(h):
        async with httpx.AsyncClient(transport=httpx.MockTransport(h)) as c:
            return await pdc._nps_get(c, "SECRETKEY123", "bass", {"wkplNm": "에스에프에이", "bzowrRgstNo": "803810"})

    pdc._nps_ok = None
    items = asyncio.run(run(handler))
    assert items[0]["seq"] == "1" and pdc._nps_ok == 0 and len(seen) == 1 and "NpsBplcInfoInqireServiceV2" in seen[0]
    # 다른 판만 되는 경우에도 차례로 내려가 찾는다
    def legacy(req):
        if req.url.path.endswith("NpsBplcInfoInqireSvc/getBassInfoSearch") and "wkpl_nm" in req.url.params:
            return httpx.Response(200, text=ok_xml)
        return httpx.Response(400, text="Bad Request")
    pdc._nps_ok = None
    assert asyncio.run(run(legacy))[0]["seq"] == "1" and pdc._nps_ok == 4

    def denied(req):
        return httpx.Response(200, text="<OpenAPI_ServiceResponse><cmmMsgHeader><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR"
                                        "</returnAuthMsg><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>")
    pdc._nps_ok = None
    try:
        asyncio.run(run(denied))
        raise AssertionError("should fail")
    except pdc.PublicDataError as e:
        assert "활용신청" in str(e) and "SECRETKEY123" not in str(e)

    def bad(req):
        return httpx.Response(400, text="Bad Request")
    try:
        asyncio.run(run(bad))
    except pdc.PublicDataError as e:
        assert "SECRETKEY123" not in str(e)
    assert pdc.mask_keys("x?serviceKey=abc&y=1 ServiceKey=zz") == "x?serviceKey=***&y=1 ServiceKey=***"
    pdc._nps_ok = None


# ---------------------------------------------------------------- 기사 본문 읽기
def test_article_reader_extract_and_google():
    from app.services.company_report import article_reader as ar

    body = "".join(f"<p>SFA반도체는 {i}번째 문단에서 반도체 후공정 사업의 실적 개선 전망을 설명했다. 회사 관계자는 투자 계획도 밝혔다.</p>" for i in range(6))
    html = (f"<html><head><title>SFA반도체 실적 - 이데일리</title></head><body><nav>메뉴 홈 경제 정치</nav>"
            f"<article><h1>SFA반도체 실적</h1>{body}</article><footer>Copyright 무단전재 금지</footer></body></html>")
    r = ar.extract(html.encode("utf-8"), "https://www.edaily.co.kr/news/1")
    assert r["chars"] > ar.MIN_CHARS and any("3번째 문단" in p for p in r["paragraphs"])
    assert not any("메뉴 홈" in p for p in r["paragraphs"])
    assert ar.google_article_id("https://news.google.com/rss/articles/CBMiAbc123?oc=5") == "CBMiAbc123"
    assert ar.google_article_id("https://www.edaily.co.kr/news/1") is None
    raw = ')]}\'\n\n[["wrb.fr","Fbv4je","[\\"garturlres\\",\\"https://www.edaily.co.kr/news/1\\",1]",null,null,null,"generic"]]'
    assert ar._parse_batchexecute(raw) == "https://www.edaily.co.kr/news/1"


def test_article_frame_allowed():
    from app.services.company_report.article_reader import frame_allowed

    assert frame_allowed({}, "https://www.mediapen.com/news/1")
    assert not frame_allowed({}, "http://www.mediapen.com/news/1")
    assert not frame_allowed({"X-Frame-Options": "SAMEORIGIN"}, "https://a.com/1")
    assert not frame_allowed({"x-frame-options": "DENY"}, "https://a.com/1")
    assert not frame_allowed({"Content-Security-Policy": "default-src 'self'; frame-ancestors 'self'"}, "https://a.com/1")
    assert frame_allowed({"Content-Security-Policy": "frame-ancestors *"}, "https://a.com/1")
    assert frame_allowed({"Content-Security-Policy": "script-src 'self'"}, "https://a.com/1")
