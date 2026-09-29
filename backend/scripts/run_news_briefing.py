"""기업 리포트 배치(Railway Cron, UTC 기준).

사용: backend 에서  python scripts/run_news_briefing.py <명령> [옵션]
  daily-build [--date YYYY-MM-DD] [--no-collect] [--force]   평일 07:00 KST  (cron: 0 22 * * 0-4)
  send        [--date YYYY-MM-DD]                            평일 08:30 KST  (cron: 30 23 * * 0-4)
  collect                                                    수동 수집+요약
  summarize   [--limit N]                                    요약만
  facts       [--limit N]                                    사실·투자유치 후보 추출 + 자동 검증
  verify-facts [--limit N]                                   후보 사실 자동 검증만
  reindex-check                                              검색 색인 누락 점검(매일 04:00 KST, cron: 0 19 * * *)
  reindex                                                    검색 색인 전체 재구축
  public-data [--force]                                      공공데이터 스냅샷(국민연금·국세청·KIPRIS·KIS)
  monthly     [--month YYYY-MM] [--force]                    매일 03:00 KST, 1일에만 지난 달 월간 브리핑 작성(cron: 0 18 * * *)
  send-monthly [--date YYYY-MM-DD]                           월간 발송만(보통은 send가 함께 보냄)
반기(half-year)는 P4에서 추가한다.
"""
import argparse
import asyncio
import json
import os
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.session import AsyncSessionLocal  # noqa: E402
from app.services.company_report import collector, daily, facts, search, sender, summarizer  # noqa: E402


async def mark_files_dirty(db) -> None:
    """Cron 컨테이너에는 Volume이 없으므로 파일은 웹 서비스가 만든다(표시만 남김)."""
    from app.services.company_report import file_worker

    await file_worker.mark_dirty(db)


async def _verify(db, limit: int) -> None:
    from app.services.company_report import fact_verify

    try:
        _print("verify-facts", await fact_verify.verify_pending(db, limit=limit))
    except Exception as e:
        print(f"[verify-facts] 실패: {e}", flush=True)


def _print(title: str, obj) -> None:
    print(f"[{title}] {json.dumps(obj, ensure_ascii=False, default=str)}", flush=True)


async def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("cmd", choices=["daily-build", "send", "collect", "summarize", "facts", "reindex-check", "reindex", "public-data", "monthly", "send-monthly", "verify-facts"])
    p.add_argument("--date")
    p.add_argument("--no-collect", action="store_true")
    p.add_argument("--force", action="store_true")
    p.add_argument("--limit", type=int, default=400)
    p.add_argument("--month")
    a = p.parse_args()
    day = date.fromisoformat(a.date) if a.date else None

    async with AsyncSessionLocal() as db:
        if a.cmd == "daily-build":
            _print("daily-build", await daily.build_daily(db, day, collect=not a.no_collect, force=a.force))
            try:  # 공공데이터 월 1회 스냅샷(이번 달 것이 없는 기업만)
                from app.services.company_report import public_data

                _print("public-data", await public_data.snapshot_due(db))
            except Exception as e:
                print(f"[public-data] 실패: {e}", flush=True)
            await _verify(db, 60)  # 브리핑을 만든 뒤 새 사실 후보 자동 검증
            await mark_files_dirty(db)
        elif a.cmd == "send":
            _print("send", await sender.send_daily(db, day))
            try:  # 지난 달 월간 브리핑이 준비돼 있으면 함께(1일이 휴일이면 다음 영업일)
                _print("send-monthly", await sender.send_monthly(db, day))
            except Exception as e:
                print(f"[send-monthly] 실패: {e}", flush=True)
            await mark_files_dirty(db)
        elif a.cmd == "send-monthly":
            _print("send-monthly", await sender.send_monthly(db, day))
        elif a.cmd == "monthly":
            from app.services.company_report import monthly

            _print("monthly", await monthly.build_monthly(db, a.month, force=a.force or bool(a.month)))
        elif a.cmd == "collect":
            _print("collect", await collector.collect_all(db, via="manual"))
            _print("summarize", await summarizer.summarize_pending(db, limit=a.limit))
            _print("facts", await facts.extract_pending(db, limit=a.limit))
            await _verify(db, a.limit)
        elif a.cmd == "summarize":
            _print("summarize", await summarizer.summarize_pending(db, limit=a.limit))
        elif a.cmd == "facts":
            _print("facts", await facts.extract_pending(db, limit=a.limit))
            await _verify(db, a.limit)
        elif a.cmd == "verify-facts":
            await _verify(db, a.limit)
        elif a.cmd == "reindex-check":
            _print("reindex-check", await search.check_missing(db))
        elif a.cmd == "public-data":
            from app.services.company_report import public_data

            _print("public-data", await public_data.snapshot_due(db, force=a.force))
        elif a.cmd == "reindex":
            _print("reindex", await search.reindex_all(db))
        from app.services.company_report import usage

        await usage.flush(db)  # AI 사용량 기록
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
