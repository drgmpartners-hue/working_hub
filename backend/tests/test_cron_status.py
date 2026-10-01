"""기업 리포트 자동 실행(Cron) 점검 — 예정 시각 계산과 상태 판정."""
from datetime import datetime

from app.services.company_report import cron_status as cs

BUILD = next(j for j in cs.JOBS if j["cmd"] == "daily-build")
SEND = next(j for j in cs.JOBS if j["cmd"] == "send")
MONTHLY = next(j for j in cs.JOBS if j["cmd"] == "monthly")


def _last(at: str, ok: bool = True) -> dict:
    return {"at": at, "ok": ok, "note": ""}


def test_expected_weekday_morning():
    # 2026-10-01(목) 09:00 → 작성 예정 오늘 07:00, 발송 예정 오늘 08:30은 아직 40분 안 지나서 어제 08:30
    now = datetime(2026, 10, 1, 9, 0)
    assert cs.last_expected(BUILD, now) == datetime(2026, 10, 1, 7, 0)
    assert cs.last_expected(SEND, now) == datetime(2026, 9, 30, 8, 30)
    assert cs.last_expected(MONTHLY, now) == datetime(2026, 10, 1, 3, 0)


def test_expected_skips_weekend():
    now = datetime(2026, 10, 5, 6, 0)  # 월요일 새벽 → 지난 금요일
    assert cs.last_expected(BUILD, now) == datetime(2026, 10, 2, 7, 0)
    assert cs.last_expected(MONTHLY, now) == datetime(2026, 10, 5, 3, 0)


def test_status_never_ok_late_failed():
    now = datetime(2026, 10, 1, 10, 0)
    assert cs.evaluate(BUILD, None, now)["status"] == "never"
    assert cs.evaluate(BUILD, _last("2026-10-01T07:03:10"), now)["status"] == "ok"
    assert cs.evaluate(BUILD, _last("2026-09-30T07:02:00"), now)["status"] == "late"
    assert cs.evaluate(BUILD, _last("2026-10-01T07:03:10", ok=False), now)["status"] == "failed"
    r = cs.evaluate(SEND, None, now)
    assert r["service"] == "briefing-send" and r["cron_utc"] == "30 23 * * 0-4"
    assert r["command"].endswith("run_news_briefing.py send")


def test_parse_bad_json():
    assert cs._parse(None) is None
    assert cs._parse("not json") is None
    assert cs._parse('{"at": "2026-10-01T07:00:00", "ok": true}')["ok"] is True
