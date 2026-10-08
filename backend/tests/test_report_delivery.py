"""반기 보고서 편집·검토 완료·출력·발송·관리·자료 요청·자동 작업 (P4-4·7·8·9·10·11)."""
import copy
import io
import uuid
import zipfile
from datetime import date, datetime

import pytest

from app.services.company_report import cron_status, doc_requests, report_edit, report_share
from app.services.company_report import half_year as hy
from tests.test_half_year import RAW
from tests.test_permissions import PG, env  # noqa: F401


def _content() -> dict:
    c = hy.normalize(copy.deepcopy(RAW))
    c["cover"] = {"company": "테스트바이오", "period": "2026년 상반기", "as_of": "2026-07-31"}
    c["summary"]["three_lines"][0]["disputed"] = True
    c["summary"]["three_lines"][0]["review_note"] = "금액 확인"
    c["appendix"] = {"citations": [{"no": 1, "id": "R2", "title": "시리즈B", "url": "https://news.example/b"}],
                     "articles": [], "dart": [], "funding_sources": [], "documents": [{"name": "IR.pdf", "is_public": False}],
                     "glossary": c.get("glossary") or [], "verification": {"total": 9, "removed": 1, "disputed": 1, "as_of": "2026-07-31"},
                     "disclaimer": "투자 권유가 아닙니다."}
    return c


# --------------------------------------------------------------------------- 순수 함수

def test_edit_item_and_disputed():
    c = _content()
    assert report_edit.disputed_count(c) == 1
    sid = c["summary"]["three_lines"][0]["id"]
    report_edit.edit_item(c, sid, text="시리즈B 150억 원을 2026년 3월에 유치했다.")
    x, _, _ = report_edit.find_item(c, sid)
    assert x["edited"] and "disputed" not in x and report_edit.disputed_count(c) == 0
    row = c["sections"][0]["blocks"][0]["rows"][0]
    report_edit.edit_item(c, row["id"], cells=["정식 기업명", "(주)테스트바이오", "넘침"])
    assert row["cells"] == ["정식 기업명", "(주)테스트바이오"]
    with pytest.raises(Exception):
        report_edit.edit_item(c, row["id"], text="표는 글로 못 고침")
    with pytest.raises(Exception):
        report_edit.edit_item(c, sid, text="   ")
    # 마지막 문장을 지우면 빈 블록도 빠진다
    concl = c["sections"][9]["blocks"][0]["items"][0]["id"]
    report_edit.edit_item(c, concl, delete=True)
    assert c["sections"][9]["blocks"] == []
    with pytest.raises(Exception):
        report_edit.edit_item(c, "s999", resolve=True)


def test_share_token_and_public_content():
    rid, cid = str(uuid.uuid4()), str(uuid.uuid4())
    t = report_share.make(rid, cid, today=date(2026, 8, 1))
    assert report_share.parse(t, today=date(2026, 8, 2)) == (rid, cid)
    with pytest.raises(report_share.ShareError):
        report_share.parse(t, today=date(2027, 3, 1))  # 180일 지남
    bad = t[:-1] + ("A" if t[-1] != "A" else "B")
    with pytest.raises(report_share.ShareError):
        report_share.parse(bad, today=date(2026, 8, 2))
    other = report_share.make(rid, str(uuid.uuid4()), today=date(2026, 8, 1))
    with pytest.raises(report_share.ShareError):  # 서명을 다른 고객 것으로 바꿔 끼우기
        report_share.parse(".".join(t.split(".")[:3] + [other.split(".")[3]]), today=date(2026, 8, 2))
    pub = report_share.public_content({**_content(), "stats": {"x": 1}})
    assert "disputed" not in pub["summary"]["three_lines"][0] and "review_note" not in pub["summary"]["three_lines"][0]
    assert "stats" not in pub and "disputed" not in pub["appendix"]["verification"]
    v = report_share.variables("홍고객", "테스트바이오", "2026년 상반기", ["a", "b"], "담당 김매니저 010-1111-2222")
    txt = report_share.lms_text(v, "https://x/m/report?t=abc")
    assert "#{" not in txt and "https://x/m/report?t=abc" in txt and "- a\n- b" in txt


def test_doc_request_periods():
    assert doc_requests.target_half(date(2026, 6, 30)) == (2026, 1)
    assert doc_requests.target_half(date(2026, 10, 1)) == (2026, 1)
    assert doc_requests.target_half(date(2026, 12, 30)) == (2026, 2)
    assert doc_requests.target_half(date(2027, 1, 20)) == (2026, 2)
    assert doc_requests.in_request_season(date(2026, 7, 10)) and not doc_requests.in_request_season(date(2026, 10, 1))
    assert doc_requests.in_request_season(date(2027, 1, 5))
    assert "3곳" in doc_requests.notice_text("김", ["가", "나", "다"], "2026년 상반기")


def test_cron_rare_jobs():
    jobs = {j["cmd"]: j for j in cron_status.JOBS}
    now = datetime(2026, 10, 1, 12, 0)
    hy_job = jobs["half-year"]
    assert cron_status.last_expected(hy_job, now) == datetime(2026, 7, 31, 2, 0)
    assert cron_status.next_expected(hy_job, now) == datetime(2027, 1, 31, 2, 0)
    ev = cron_status.evaluate(hy_job, None, now)
    assert ev["status"] == "pending" and ev["next_at"] == "2027-01-31T02:00"
    assert cron_status.evaluate(jobs["daily-build"], None, now)["status"] == "never"
    # 7/31 실행 기록이 있으면 정상, 1/31 를 놓치면 늦음
    ok = {"at": "2026-07-31T02:01:00", "ok": True}
    assert cron_status.evaluate(hy_job, ok, now)["status"] == "ok"
    assert cron_status.evaluate(hy_job, ok, datetime(2027, 2, 2, 9, 0))["status"] == "late"
    mon = jobs["report-reminders"]
    assert cron_status.last_expected(mon, datetime(2026, 10, 1, 12, 0)) == datetime(2026, 9, 28, 9, 0)
    assert cron_status.next_expected(jobs["doc-requests"], now) == datetime(2026, 12, 30, 9, 0)


# --------------------------------------------------------------------------- 실제 DB

async def _make_report(Session, cid: str, owner_user_id=None, status="draft", version=1):
    from app.models.company_report import CompanyReport, ReportImage
    from app.services.company_report import storage
    from PIL import Image

    b = io.BytesIO()
    Image.new("RGB", (400, 260), (30, 80, 160)).save(b, "PNG")
    async with Session() as db:
        r = CompanyReport(company_id=cid, period_year=2026, period_half=1, version=version, owner_user_id=owner_user_id,
                          status=status, progress=100, progress_step="완료", as_of_date=date(2026, 7, 31), content=_content(),
                          sources={"R2": {"no": 1, "title": "시리즈B", "url": "https://news.example/b"}},
                          review={"summary": {"total": 9}}, sales_note={"key_messages": ["내부용"]})
        db.add(r)
        await db.flush()
        for i in range(3):
            key = storage.make_key(cid, "reports", f"img{uuid.uuid4().hex[:6]}", "png")
            storage.save_bytes(key, b.getvalue())
            db.add(ReportImage(report_id=r.id, section_no=4 + i, kind="chart", storage_key=key, caption=f"그림{i}",
                               sort_order=i, selected=i < 2, width=400, height=260))
        await db.commit()
        return r.id


@pytest.mark.skipif(not PG, reason="PERM_PG_URL 없음(실제 PostgreSQL 필요)")
async def test_edit_finalize_export_send(env, monkeypatch, tmp_path):  # noqa: F811
    from sqlalchemy import select

    from app.models.client import Client
    from app.models.company_report import CompanyFile, CompanyReport, ReportExport
    from app.models.news_briefing import BriefingSendLog
    from app.services import solapi_service

    monkeypatch.setenv("COMPANY_DB_ROOT", str(tmp_path))
    c, d, hdr, Session = env["c"], env["d"], env["hdr"], env["Session"]
    ha, hb, ho = hdr(d["A"]), hdr(d["B"]), hdr(d["owner"])
    cid = (await c.post("/company-report/companies", headers=ha, json={"name": f"전달-{uuid.uuid4().hex[:6]}", "backfill_months": 0})).json()["id"]
    await c.post("/company-report/companies", headers=hb, json={"name": "x", "backfill_months": 0})
    base = await _make_report(Session, cid)
    async with Session() as db:
        cl = await db.get(Client, d["client_A"])
        cl.phone = "010-1234-5678"
        await db.commit()

    # 공용본 출력(PDF·DOCX) → 기업DB 04_보고서에 저장 + 기록
    r = await c.get(f"/company-report/reports/{base}/export", params={"format": "pdf"}, headers=ha)
    assert r.status_code == 200 and r.content[:4] == b"%PDF" and "attachment" in r.headers["content-disposition"]
    r = await c.get(f"/company-report/reports/{base}/export", params={"format": "docx"}, headers=ha)
    assert r.status_code == 200 and r.content[:2] == b"PK"
    # 남의 고객용 출력은 막힘, 내 고객용은 저장하지 않고 기록만
    assert (await c.get(f"/company-report/reports/{base}/export", params={"client_id": d["client_B"]}, headers=ha)).status_code == 404
    assert (await c.get(f"/company-report/reports/{base}/export", params={"client_id": d["client_A"]}, headers=ha)).status_code == 200
    async with Session() as db:
        files = (await db.execute(select(CompanyFile).where(CompanyFile.company_id == cid, CompanyFile.folder == "reports"))).scalars().all()
        assert sorted(f.file_type for f in files) == ["docx", "pdf"]
        ex = (await db.execute(select(ReportExport).where(ReportExport.report_id == base))).scalars().all()
        assert len(ex) == 3 and sum(1 for e in ex if e.client_id == d["client_A"] and e.file_id is None) == 1

    # 아직 검토 완료 전이면 발송 불가
    assert (await c.post(f"/company-report/reports/{base}/send", headers=ha, json={"client_ids": [d["client_A"]]})).status_code == 409

    # 문장 고치기 → 내 버전(v1)이 새로 생김, 공용본은 그대로
    full = (await c.get(f"/company-report/reports/{base}", headers=ha)).json()
    assert full["disputed_count"] == 1 and full["mine"] is False
    sid = full["content"]["summary"]["three_lines"][0]["id"]
    r = await c.patch(f"/company-report/reports/{base}/items/{sid}", headers=ha, json={"text": "고친 문장이다."})
    assert r.status_code == 200
    mine = r.json()
    assert mine["id"] != base and mine["mine"] and mine["owner_user_id"] == d["A"] and mine["base_report_id"] == base
    assert mine["content"]["summary"]["three_lines"][0]["text"] == "고친 문장이다." and mine["disputed_count"] == 0
    assert len(mine["images"]) == 3
    # 같은 내 버전(검토 중)을 다시 고치면 그 자리에서
    sid2 = mine["content"]["summary"]["changes"][0]["id"]
    r = await c.patch(f"/company-report/reports/{mine['id']}/items/{sid2}", headers=ha, json={"delete": True})
    assert r.json()["id"] == mine["id"] and r.json()["content"]["summary"]["changes"] == []
    base_full = (await c.get(f"/company-report/reports/{base}", headers=ha)).json()
    assert base_full["content"]["summary"]["three_lines"][0]["text"] != "고친 문장이다."
    # 남(B)은 A의 개인 버전을 못 보고, 대표는 본다
    assert (await c.get(f"/company-report/reports/{mine['id']}", headers=hb)).status_code == 404
    assert (await c.get(f"/company-report/reports/{mine['id']}", headers=ho)).status_code == 200
    assert (await c.patch(f"/company-report/reports/{mine['id']}/items/{sid}", headers=hb, json={"resolve": True})).status_code == 404
    # 빈 요청은 422
    assert (await c.patch(f"/company-report/reports/{mine['id']}/items/{sid}", headers=ha, json={})).status_code == 422

    # 그림: 공용본 그림 id 로 고쳐도 내 버전의 같은 그림이 바뀐다
    img_unsel = next(i for i in base_full["images"] if not i["selected"])
    r = await c.patch(f"/company-report/reports/{mine['id']}/images/{img_unsel['id']}", headers=ha, json={"selected": True})
    assert r.status_code == 404  # 다른 보고서의 그림 id
    my_img = next(i for i in mine["images"] if not i["selected"])
    r = await c.patch(f"/company-report/reports/{mine['id']}/images/{my_img['id']}", headers=ha,
                      json={"selected": True, "caption": "새 설명"})
    assert r.status_code == 200 and sum(1 for i in r.json()["images"] if i["selected"]) == 3
    assert next(i for i in r.json()["images"] if i["id"] == my_img["id"])["caption"] == "새 설명"

    # 검토 완료 → 경고(확인 필요 개수·그림 수)와 함께 final
    r = await c.post(f"/company-report/reports/{mine['id']}/finalize", headers=ha)
    assert r.status_code == 200
    fin = r.json()
    assert fin["report"]["status"] == "final" and fin["report"]["id"] == mine["id"] and fin["warnings"]["images"] == 3
    assert fin["report"]["finalized_by_name"]
    assert (await c.post(f"/company-report/reports/{mine['id']}/finalize", headers=ha)).status_code == 409
    # 검토 완료본을 다시 고치면 새 버전(v2)
    r = await c.patch(f"/company-report/reports/{mine['id']}/items/{sid}", headers=ha, json={"resolve": True})
    v2 = r.json()
    assert v2["id"] != mine["id"] and v2["version"] == 2 and v2["status"] == "draft"

    # 발송: 내 고객만, 휴대폰 없는 고객은 건너뜀
    sent = {}

    async def fake_send(db, msgs, sender=None):
        sent["msgs"] = msgs
        return {"success": True, "groupId": "G1"}

    monkeypatch.setattr(solapi_service, "send_many_alimtalk", fake_send)
    assert (await c.post(f"/company-report/reports/{mine['id']}/send", headers=ha, json={"client_ids": [d["client_B"]]})).status_code == 404
    assert (await c.post(f"/company-report/reports/{mine['id']}/send", headers=hb, json={"client_ids": [d["client_B"]]})).status_code == 404
    r = await c.post(f"/company-report/reports/{mine['id']}/send", headers=ha, json={"client_ids": [d["client_A"], d["client_A"]]})
    assert r.status_code == 200 and r.json()["sent"] == 1 and r.json()["channel"] == "lms"
    msg = sent["msgs"][0]
    assert len(sent["msgs"]) == 1 and msg["to"] == "010-1234-5678" and "/m/report?t=" in msg["text"] and "고객A" in msg["text"]
    token = msg["text"].split("/m/report?t=")[1].split()[0]
    async with Session() as db:
        logs = (await db.execute(select(BriefingSendLog).where(BriefingSendLog.briefing_id == mine["id"]))).scalars().all()
        assert len(logs) == 1 and logs[0].briefing_type == "report" and logs[0].channel == "lms"
    clients = (await c.get("/company-report/report-send/clients", params={"report_id": mine["id"]}, headers=ha)).json()
    assert [x["id"] for x in clients] == [d["client_A"]] and clients[0]["sent_at"] and clients[0]["phone_masked"] == "010-****-5678"

    # 고객 폰 화면(로그인 없음): 내부 표시·영업 노트 없음, 고른 그림만
    r = await c.get("/company-report/m/report", params={"t": token})
    assert r.status_code == 200
    pub = r.json()
    assert pub["client_name"] == "고객A" and pub["period_label"] == "2026년 상반기" and "sales_note" not in pub
    assert all("disputed" not in x for x in pub["content"]["summary"]["three_lines"]) and len(pub["images"]) == 3
    assert "담당" in pub["contact"]
    assert (await c.get(f"/company-report/m/report/image/{pub['images'][0]['id']}", params={"t": token})).status_code == 200
    assert (await c.get(f"/company-report/m/report/image/{base_full['images'][0]['id']}", params={"t": token})).status_code == 404
    r = await c.get("/company-report/m/report/pdf", params={"t": token})
    assert r.status_code == 200 and r.content[:4] == b"%PDF"
    assert (await c.get("/company-report/m/report", params={"t": token[:-2] + "zz"})).status_code == 403
    # 보낸 뒤 그 버전이 '검토 중'으로 바뀌는 일은 없지만, 지워지면 링크도 닫힌다
    async with Session() as db:
        rr = await db.get(CompanyReport, mine["id"])
        rr.status = "failed"
        await db.commit()
    assert (await c.get("/company-report/m/report", params={"t": token})).status_code == 404
    async with Session() as db:
        rr = await db.get(CompanyReport, mine["id"])
        rr.status = "final"
        await db.commit()

    # 출력·발송 기록: A 는 자기 것, 대표는 전체(고객 이름은 볼 수 있는 사람에게만)
    hist = (await c.get("/company-report/report-exports", headers=ha)).json()
    assert {h["format"] for h in hist} >= {"pdf", "docx", "link"} and any(h["client_name"] == "고객A" for h in hist)
    assert (await c.get("/company-report/report-exports", headers=hb)).json() == []
    assert len((await c.get("/company-report/report-exports", headers=ho)).json()) >= len(hist)


@pytest.mark.skipif(not PG, reason="PERM_PG_URL 없음(실제 PostgreSQL 필요)")
async def test_overview_batch_content_docreq_jobs(env, monkeypatch, tmp_path):  # noqa: F811
    from sqlalchemy import select

    from app.models.company_report import CompanyDocument, CompanyFile, CompanyReport
    from app.models.user import User
    from app.services import solapi_service
    from app.services.company_report import report_jobs

    monkeypatch.setenv("COMPANY_DB_ROOT", str(tmp_path))
    c, d, hdr, Session = env["c"], env["d"], env["hdr"], env["Session"]
    ha, hb, ho = hdr(d["A"]), hdr(d["B"]), hdr(d["owner"])
    c1 = (await c.post("/company-report/companies", headers=ha, json={"name": f"관리1-{uuid.uuid4().hex[:6]}", "backfill_months": 0})).json()["id"]
    c2 = (await c.post("/company-report/companies", headers=ha, json={"name": f"관리2-{uuid.uuid4().hex[:6]}", "backfill_months": 0})).json()["id"]
    await _make_report(Session, c1)
    mine_final = await _make_report(Session, c1, owner_user_id=d["A"], status="final", version=1)

    ov = (await c.get("/company-report/reports-overview", params={"year": 2026, "half": 1}, headers=ha)).json()
    rows = {x["company_id"]: x for x in ov["companies"]}
    assert rows[c1]["stage"] == "final" and rows[c1]["report"]["id"] == mine_final and rows[c1]["report"]["mine"]
    assert rows[c2]["stage"] == "none" and rows[c2]["report"] is None
    assert ov["counts"].get("final", 0) >= 1 and ov["period_label"] == "2026년 상반기"
    # B 는 A 기업을 못 봄
    ovb = (await c.get("/company-report/reports-overview", params={"year": 2026, "half": 1}, headers=hb)).json()
    assert c1 not in {x["company_id"] for x in ovb["companies"]}
    # 대표는 A 의 개인 버전을 'others' 로 본다
    ovo = (await c.get("/company-report/reports-overview", params={"year": 2026, "half": 1}, headers=ho)).json()
    row_o = next(x for x in ovo["companies"] if x["company_id"] == c1)
    assert row_o["stage"] == "draft" and row_o["others"][0]["owner_user_id"] == d["A"] and row_o["others"][0]["owner_name"]

    # 일괄 출력 zip: 보고서 없는 기업은 안내 파일
    r = await c.post("/company-report/reports/export-batch", headers=ha, json={"company_ids": [c1, c2], "year": 2026, "half": 1})
    assert r.status_code == 200
    z = zipfile.ZipFile(io.BytesIO(r.content))
    names = z.namelist()
    assert len([n for n in names if n.endswith(".pdf")]) == 1 and "_빠진_기업.txt" in names
    assert (await c.post("/company-report/reports/export-batch", headers=ha, json={"company_ids": [c2], "year": 2026, "half": 1})).status_code == 409
    assert (await c.post("/company-report/reports/export-batch", headers=hb, json={"company_ids": [c1], "year": 2026, "half": 1})).status_code == 404

    # 연동 API: 요약만(내부 표시 없음), 없으면 available false
    rc = (await c.get(f"/company-report/companies/{c1}/report-content", headers=ha)).json()
    assert rc["available"] and rc["report_id"] == mine_final and rc["three_lines"] and rc["period_label"] == "2026년 상반기"
    assert (await c.get(f"/company-report/companies/{c2}/report-content", headers=ha)).json() == {"available": False}

    # 자료 요청 체크리스트: 직접 표시 + 자료함 문서로 자동 표시
    dr = (await c.get(f"/company-report/companies/{c1}/doc-requests", params={"year": 2026, "half": 1}, headers=ha)).json()
    assert dr["done"] == 0 and dr["total"] == 6
    dr = (await c.patch(f"/company-report/companies/{c1}/doc-requests", params={"year": 2026, "half": 1}, headers=ha,
                        json={"key": "shareholders", "done": True, "note": "메일로 받음"})).json()
    assert dr["done"] == 1 and next(x for x in dr["items"] if x["key"] == "shareholders")["note"] == "메일로 받음"
    async with Session() as db:
        f = CompanyFile(company_id=c1, folder="docs", display_name="재무.pdf", storage_key="k", file_type="pdf", size=1)
        db.add(f)
        await db.flush()
        db.add(CompanyDocument(company_id=c1, file_id=f.id, filename="2026반기재무.pdf", file_type="pdf", extract_status="done",
                               doc_type="financial"))
        await db.commit()
    dr = (await c.get(f"/company-report/companies/{c1}/doc-requests", params={"year": 2026, "half": 1}, headers=ha)).json()
    fin = next(x for x in dr["items"] if x["key"] == "financial")
    assert dr["done"] == 2 and fin["done"] and not fin["manual"] and fin["auto_files"] == ["2026반기재무.pdf"]
    assert (await c.patch(f"/company-report/companies/{c1}/doc-requests", params={"year": 2026, "half": 1}, headers=ha,
                          json={"key": "nope", "done": True})).status_code == 422
    assert (await c.get(f"/company-report/companies/{c1}/doc-requests", headers=hb)).status_code == 404

    # 자동 작업: 예약 → 웹 작업자가 집어 감(작성 함수는 가짜)
    ran = []

    async def fake_run(db, rid):
        r = await db.get(CompanyReport, rid)
        r.status, r.progress = "draft", 100
        r.content = _content()
        await db.commit()
        ran.append(rid)
        return r

    monkeypatch.setattr(hy, "run_report", fake_run)
    async with Session() as db:
        q = await report_jobs.queue_half_year(db, 2026, 1)
        assert q["queued"] >= 1  # c1 은 공용본이 있어 건너뜀, c2 는 예약
        q_rows = (await db.execute(select(CompanyReport).where(CompanyReport.company_id == c2))).scalars().all()
        assert len(q_rows) == 1 and q_rows[0].progress_step == report_jobs.QUEUED
        again = await report_jobs.queue_half_year(db, 2026, 1)
        assert again["queued"] == 0
    # 예약된 것을 사람이 [만들기] 하면 새로 만들지 않고 바로 시작
    called = []

    async def fake_bg(rid):
        called.append(rid)

    monkeypatch.setattr(hy, "run_in_background", fake_bg)
    r = await c.post(f"/company-report/companies/{c2}/reports", headers=ha, json={"year": 2026, "half": 1})
    assert r.status_code == 202 and r.json()["id"] == q_rows[0].id and called == [q_rows[0].id]
    async with Session() as db:
        rr = await db.get(CompanyReport, q_rows[0].id)
        rr.progress_step = report_jobs.QUEUED  # 다시 예약 상태로 돌려 작업자 시험
        await db.commit()
        out = await report_jobs.run_queued(db, limit=50)
        assert q_rows[0].id in ran and out["ran"] >= 1
        assert (await db.get(CompanyReport, q_rows[0].id)).status == "draft"

    # 검토 알림·자료 요청 알림(시험 실행 + 발송 켠 실제 호출은 가짜 솔라피)
    async with Session() as db:
        ua = await db.get(User, d["A"])
        ua.phone = "010-9999-0000"
        await db.commit()
        pend = await report_jobs.pending_review(db, 2026, 1)
        assert c2 not in str(pend)  # 검토 담당을 정하기 전에는 알리지 않는다(2026-10-08)
    assert (await c.put(f"/company-report/companies/{c2}/report-reviewers", headers=ho, json={"user_ids": [d["A"]]})).status_code == 200
    async with Session() as db:
        pend = await report_jobs.pending_review(db, 2026, 1)
        assert c2 and d["A"] in pend and any(n.startswith("관리2") for n in pend[d["A"]]["companies"])
        dry = await report_jobs.remind(db, dry_run=True, today=date(2026, 10, 5))
        assert dry["targets"] >= 1 and "검토 완료" in dry["preview"][0]["text"]
        from app.services import settings_store
        from app.services.company_report import config

        await settings_store.set_value(db, config.BRIEFING_ENABLED, "0")
        off = await doc_requests.notify(db, today=date(2026, 6, 30))
        assert off["sent"] == 0 and off.get("skipped") == "발송 꺼짐"
        await settings_store.set_value(db, config.BRIEFING_ENABLED, "1")
        got = {}

        async def fake_send(db_, msgs, sender=None):
            got["n"] = len(msgs)
            got["text"] = msgs[0]["text"]
            return {"success": True}

        monkeypatch.setattr(solapi_service, "send_many_alimtalk", fake_send)
        res = await doc_requests.notify(db, today=date(2026, 6, 30))
        assert res["sent"] >= 1 and "2026년 상반기" in got["text"]
        assert (await doc_requests.checklist(db, c1, 2026, 1))["requested_at"]
        res = await report_jobs.remind(db, today=date(2026, 10, 5))
        assert res["sent"] >= 1
        await settings_store.set_value(db, config.BRIEFING_ENABLED, "0")


@pytest.mark.skipif(not PG, reason="PERM_PG_URL 없음(실제 PostgreSQL 필요)")
async def test_reviewer_designation_and_official_version(env, monkeypatch, tmp_path):  # noqa: F811
    """대표가 기업마다 검토 담당을 정한다(2026-10-08). 검토 담당이 검토 완료한 버전은 공식본 —
    다른 담당자도 보고 고객에게 보낸다. 주간 검토 알림은 검토 담당에게만, 공식본이 생기면 멈춘다."""
    from app.models.news_briefing import CompanyMember
    from app.models.user import User
    from app.services.company_report import report_jobs

    monkeypatch.setenv("COMPANY_DB_ROOT", str(tmp_path))
    c, d, hdr, Session = env["c"], env["d"], env["hdr"], env["Session"]
    ha, hb, ho = hdr(d["A"]), hdr(d["B"]), hdr(d["owner"])
    cid = (await c.post("/company-report/companies", headers=ha, json={"name": f"검토-{uuid.uuid4().hex[:6]}", "backfill_months": 0})).json()["id"]
    async with Session() as db:
        db.add(CompanyMember(company_id=cid, user_id=d["B"]))  # B 도 같은 기업을 목록에 둠
        for uid, ph in ((d["A"], "010-1000-0001"), (d["B"], "010-1000-0002")):
            (await db.get(User, uid)).phone = ph
        await db.commit()
    shared = await _make_report(Session, cid)
    url = f"/company-report/companies/{cid}/report-reviewers"

    # 대표만 정한다. 목록에 없는 매니저는 안 됨, 대표 본인은 목록에 넣어 준다
    assert (await c.put(url, headers=ha, json={"user_ids": [d["A"]]})).status_code == 403
    async with Session() as db:
        assert d["A"] not in await report_jobs.pending_review(db, 2026, 1)  # 아직 아무도 안 정함
    r = await c.put(url, headers=ho, json={"user_ids": [d["B"], d["owner"]]})
    assert r.status_code == 200, r.text
    assert {m["id"] for m in r.json()["reviewers"]} == {d["B"], d["owner"]}
    r = await c.put(url, headers=ho, json={"user_ids": [d["B"]]})
    assert [m["id"] for m in r.json()["reviewers"]] == [d["B"]]
    async with Session() as db:
        pend = await report_jobs.pending_review(db, 2026, 1)
        assert d["B"] in pend and d["A"] not in pend
        dry = await report_jobs.remind(db, dry_run=True, today=date(2026, 10, 5))
        assert "검토 담당" in dry["preview"][0]["text"]

    # A(검토 담당 아님)가 검토 완료하면 자기 버전일 뿐 — 공식본 아님, 알림도 계속
    fa = (await c.post(f"/company-report/reports/{shared}/finalize", headers=ha)).json()["report"]
    assert not fa["official"] and fa["can_send"]
    async with Session() as db:
        assert d["B"] in await report_jobs.pending_review(db, 2026, 1)

    # B(검토 담당)가 검토 완료 → 공식본
    fb = (await c.post(f"/company-report/reports/{shared}/finalize", headers=hb)).json()["report"]
    assert fb["official"] and fb["status"] == "final"
    async with Session() as db:
        assert d["B"] not in await report_jobs.pending_review(db, 2026, 1)  # 공식본이 생기면 알림 멈춤

    # 다른 사람도 공식본을 보고 보낼 수 있다(자기 버전이 없으면 공식본이 '지금 쓸 보고서')
    assert (await c.get(f"/company-report/reports/{fb['id']}", headers=ha)).status_code == 200
    assert fb["id"] in {x["id"] for x in (await c.get(f"/company-report/companies/{cid}/reports", headers=ha)).json()}
    async with Session() as db:
        from app.models.company_report import CompanyReport

        await db.delete(await db.get(CompanyReport, fa["id"]))  # A 의 개인 버전을 지워 공식본이 고르도록
        await db.commit()
    ov = (await c.get("/company-report/reports-overview", params={"year": 2026, "half": 1}, headers=ha)).json()
    row = next(x for x in ov["companies"] if x["company_id"] == cid)
    assert row["report"]["id"] == fb["id"] and row["report"]["official"] and row["report"]["can_send"]
    assert row["official"]["by_name"] and [m["id"] for m in row["reviewers"]] == [d["B"]]
    sent = {}

    async def fake_send(db, report, clients, sender):
        sent["report"] = report.id
        return {"sent": len(clients)}

    from app.services.company_report import report_share

    monkeypatch.setattr(report_share, "send", fake_send)
    r = await c.post(f"/company-report/reports/{fb['id']}/send", headers=ha, json={"client_ids": [d["client_A"]]})
    assert r.status_code == 200, r.text
    assert sent["report"] == fb["id"]

    # 지정 해제
    assert (await c.put(url, headers=ho, json={"user_ids": []})).json()["reviewers"] == []
