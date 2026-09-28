"""KST 시간 헬퍼. 서버(Railway) 시간대가 UTC여도 기업 리포트는 KST(naive)로 저장·판단한다."""
from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

KST = ZoneInfo("Asia/Seoul")


def now_kst() -> datetime:
    return datetime.now(KST).replace(tzinfo=None)


def today_kst() -> date:
    return now_kst().date()
