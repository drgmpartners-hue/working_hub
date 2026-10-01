"""기업 리포트 자동 실행(Railway Cron) 점검.

Railway Cron 서비스가 scripts/run_news_briefing.py 를 실행할 때마다 '언제·성공 여부'를 app_settings 에 남기고,
발송 설정 탭에서 예정 시각과 비교해 '정상 / 늦음 / 실패 / 한 번도 안 돎'을 보여 준다.
화면의 [지금 만들기]·[지금 발송]은 여기에 기록하지 않는다(그건 사람이 누른 것이라 Cron 이 도는지 알 수 없다).

휴일에도 Cron 은 돌고(스크립트가 알아서 건너뜀) 기록이 남으므로 휴일 계산은 필요 없다.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.services import settings_store
from app.services.company_report.timeutil import now_kst

KEY_PREFIX = "cr_cron_last:"
GRACE = timedelta(minutes=40)  # 예정 시각 뒤 이만큼 지나도 기록이 없으면 '늦음'

# (명령, 화면 이름, KST 시, 분, 평일만/특정 날짜(dates)/특정 요일(weekday, 월=0), Railway 서비스 이름, UTC cron)
JOBS: list[dict] = [
    {"cmd": "daily-build", "label": "데일리 브리핑 작성", "hour": 7, "minute": 0, "weekdays_only": True,
     "service": "briefing-build", "cron_utc": "0 22 * * 0-4", "when": "평일 07:00"},
    {"cmd": "send", "label": "데일리 발송(월간 포함)", "hour": 8, "minute": 30, "weekdays_only": True,
     "service": "briefing-send", "cron_utc": "30 23 * * 0-4", "when": "평일 08:30"},
    {"cmd": "monthly", "label": "월간 브리핑 작성", "hour": 3, "minute": 0, "weekdays_only": False,
     "service": "briefing-monthly", "cron_utc": "0 18 * * *", "when": "매일 03:00 (1일에만 작성)"},
    # 반기 보고서(P4-11). 드물게 도는 작업(rare)은 한 번도 안 돌았어도 첫 예정일 전이면 빨간불이 아니라 '첫 실행 대기'.
    {"cmd": "half-year", "label": "반기 보고서 예약", "hour": 2, "minute": 0, "weekdays_only": False,
     "dates": [(1, 31), (7, 31)], "rare": True,
     "service": "report-half-year", "cron_utc": "0 17 30 1,7 *", "when": "1/31·7/31 02:00"},
    {"cmd": "doc-requests", "label": "보고서 자료 요청 알림", "hour": 9, "minute": 0, "weekdays_only": False,
     "dates": [(6, 30), (12, 30)], "rare": True,
     "service": "report-doc-requests", "cron_utc": "0 0 30 6,12 *", "when": "6/30·12/30 09:00"},
    {"cmd": "report-reminders", "label": "보고서 검토 알림", "hour": 9, "minute": 0, "weekdays_only": False,
     "weekday": 0, "rare": True,
     "service": "report-reminders", "cron_utc": "0 0 * * 1", "when": "매주 월 09:00"},
]
TRACKED = {j["cmd"] for j in JOBS}


async def record(db: AsyncSession, cmd: str, ok: bool, note: str = "") -> None:
    """스크립트가 끝날 때(성공·실패 모두) 부른다. 추적 대상이 아니면 무시."""
    if cmd not in TRACKED:
        return
    payload = {"at": now_kst().isoformat(timespec="seconds"), "ok": bool(ok), "note": (note or "")[:300]}
    await settings_store.set_value(db, KEY_PREFIX + cmd, json.dumps(payload, ensure_ascii=False))


def _runs_on(job: dict, d) -> bool:
    if job.get("dates"):
        return (d.month, d.day) in job["dates"]
    if job.get("weekday") is not None:
        return d.weekday() == job["weekday"]
    return not job["weekdays_only"] or d.weekday() < 5


def last_expected(job: dict, now: datetime) -> Optional[datetime]:
    """now(KST) 기준, 이미 GRACE 까지 지났어야 하는 가장 최근 예정 시각."""
    cutoff = now - GRACE
    d = cutoff.date()
    for _ in range(370):
        t = datetime(d.year, d.month, d.day, job["hour"], job["minute"])
        if t <= cutoff and _runs_on(job, d):
            return t
        d -= timedelta(days=1)
    return None


def next_expected(job: dict, now: datetime) -> Optional[datetime]:
    d = now.date()
    for _ in range(370):
        t = datetime(d.year, d.month, d.day, job["hour"], job["minute"])
        if t > now and _runs_on(job, d):
            return t
        d += timedelta(days=1)
    return None


def _parse(raw: Optional[str]) -> Optional[dict]:
    if not raw:
        return None
    try:
        v = json.loads(raw)
        datetime.fromisoformat(v["at"])
        return v
    except Exception:
        return None


def evaluate(job: dict, last: Optional[dict], now: datetime) -> dict:
    expected = last_expected(job, now)
    if last is None:
        # 드문 작업은 배포 후 첫 예정일이 아직 안 왔을 수 있다 → 빨간불 대신 '첫 실행 대기'
        status = "pending" if job.get("rare") else "never"
    elif not last.get("ok", True):
        status = "failed"
    elif expected and datetime.fromisoformat(last["at"]) < expected - timedelta(minutes=5):
        status = "late"
    else:
        status = "ok"
    return {
        "cmd": job["cmd"], "label": job["label"], "when": job["when"],
        "service": job["service"], "cron_utc": job["cron_utc"],
        "command": f"python scripts/run_news_briefing.py {job['cmd']}",
        "last_at": last["at"] if last else None, "last_ok": last.get("ok") if last else None,
        "last_note": last.get("note") if last else None,
        "expected_at": expected.isoformat(timespec="minutes") if expected else None,
        "next_at": (lambda n: n.isoformat(timespec="minutes") if n else None)(next_expected(job, now)),
        "status": status,
    }


async def report(db: AsyncSession, now: Optional[datetime] = None) -> list[dict]:
    now = now or now_kst()
    out = []
    for job in JOBS:
        out.append(evaluate(job, _parse(await settings_store.get(db, KEY_PREFIX + job["cmd"])), now))
    return out
