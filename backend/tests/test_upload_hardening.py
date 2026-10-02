"""수정_tasks P2-13 — 업로드: 크기 한도(메모리 전량 적재), 고아 파일, OCR 날짜 알림, 엑셀 형식 안내."""
import io
import os
from datetime import date, timedelta

import pytest
from fastapi import HTTPException, UploadFile

from tests.test_permissions import PG, env  # noqa: F401  (앱 설정보다 먼저 — DATABASE_URL 지정)
from app.core.uploads import read_limited  # noqa: E402
from app.services.snapshot_service import resolve_snapshot_date  # noqa: E402


def _upload(data: bytes, name: str = "a.png") -> UploadFile:
    return UploadFile(file=io.BytesIO(data), filename=name)


async def test_read_limited_stops_over_limit_and_rejects_empty():
    assert await read_limited(_upload(b"x" * 100), 1000) == b"x" * 100
    with pytest.raises(HTTPException) as e:
        await read_limited(_upload(b"x" * 3_000_000), 2 * 1024 * 1024)
    assert e.value.status_code == 413
    with pytest.raises(HTTPException) as e:
        await read_limited(_upload(b""), 1000)
    assert e.value.status_code == 400


def test_resolve_snapshot_date_notice():
    entered = date.today() - timedelta(days=3)
    # 같으면 알림 없음
    d, n = resolve_snapshot_date(entered, entered.isoformat())
    assert d == entered and n is None
    # 다르면 캡처 날짜를 쓰되 알림
    cap = entered - timedelta(days=10)
    d, n = resolve_snapshot_date(entered, cap.isoformat())
    assert d == cap and n["entered"] == entered.isoformat() and n["used"] == cap.isoformat() and n["message"]
    # 미래·이상한 날짜는 입력한 날짜 유지 + 알림
    d, n = resolve_snapshot_date(entered, (date.today() + timedelta(days=30)).isoformat())
    assert d == entered and n["used"] == entered.isoformat()
    # 못 읽으면 조용히 입력 날짜
    assert resolve_snapshot_date(entered, "2026/13/45") == (entered, None)
    assert resolve_snapshot_date(entered, None) == (entered, None)


@pytest.mark.skipif(not PG, reason="PERM_PG_URL 없음(실제 PostgreSQL 필요)")
async def test_snapshot_upload_cleans_files_and_reports_date(env, tmp_path, monkeypatch):  # noqa: F811
    from app.services import snapshot_service

    c, d, hdr = env["c"], env["d"], env["hdr"]
    h = hdr(d["A"])
    monkeypatch.setattr(snapshot_service, "UPLOAD_DIR", str(tmp_path))

    # 1) 인식 실패(422) → 이미지 파일이 남지 않는다
    async def fail(*a, **k):
        return {"holdings": []}

    monkeypatch.setattr(snapshot_service, "extract_portfolio_from_image", fail)
    entered = date.today() - timedelta(days=2)
    r = await c.post("/snapshots", headers=h, data={"client_account_id": d["account_A"], "snapshot_date": entered.isoformat()},
                     files={"image": ("cap.png", b"\x89PNG fake", "image/png")})
    assert r.status_code == 422, r.text
    assert os.listdir(tmp_path) == []

    # 2) 성공 + 캡처 날짜가 다르면 알림, 날짜는 캡처 기준
    cap = entered - timedelta(days=5)

    async def ok(*a, **k):
        return {"holdings": [], "deposit_amount": 1000, "total_assets": 1000, "snapshot_date": cap.isoformat()}

    monkeypatch.setattr(snapshot_service, "extract_portfolio_from_image", ok)
    r = await c.post("/snapshots", headers=h, data={"client_account_id": d["account_A"], "snapshot_date": entered.isoformat()},
                     files={"image": ("cap.png", b"\x89PNG fake", "image/png")})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["snapshot_date"] == cap.isoformat()
    assert body["parsed_data"]["date_notice"]["entered"] == entered.isoformat()
    assert len(os.listdir(tmp_path)) == 1

    # 3) 스냅샷을 지우면 이미지도 지워진다
    r = await c.delete(f"/snapshots/{body['id']}", headers=h)
    assert r.status_code in (200, 204), r.text
    assert os.listdir(tmp_path) == []

    # 4) 너무 큰 이미지는 413
    import app.core.uploads as up

    monkeypatch.setattr(up, "IMAGE_MAX", 10)
    r = await c.post("/snapshots", headers=h, data={"client_account_id": d["account_A"], "snapshot_date": entered.isoformat()},
                     files={"image": ("cap.png", b"x" * 100, "image/png")})
    assert r.status_code == 413, r.text
    assert os.listdir(tmp_path) == []


@pytest.mark.skipif(not PG, reason="PERM_PG_URL 없음(실제 PostgreSQL 필요)")
async def test_excel_upload_rejects_xls_with_message(env):  # noqa: F811
    c, d, hdr = env["c"], env["d"], env["hdr"]
    r = await c.post("/clients/upload-excel", headers=hdr(d["A"]), files={"file": ("old.xls", b"\xd0\xcf\x11\xe0", "application/vnd.ms-excel")})
    assert r.status_code == 400 and ".xlsx" in r.json()["detail"]
