"""기업 리포트 배치(Railway Cron, UTC 기준).

사용: backend 에서  python scripts/run_news_briefing.py <명령> [옵션]
  daily-build [--date YYYY-MM-DD] [--no-collect] [--force]   평일 07:00 KST  (cron: 0 22 * * 0-4)
  send        [--date YYYY-MM-DD]                            평일 08:30 KST  (cron: 30 23 * * 0-4)
  collect                                                    수동 수집+요약
  summarize   [--limit N]                                    요약만
월간(monthly)·반기(half-year)·재색인(reindex)은 P3~P5에서 추가한다.
"""
import argparse
import asyncio
import json
import os
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.session import AsyncSessionLocal  # noqa: E402
from app.services.company_report import collector, daily, sender, summarizer  # noqa: E402


def _print(title: str, obj) -> None:
    print(f"[{title}] {json.dumps(obj, ensure_ascii=False, default=str)}", flush=True)


async def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("cmd", choices=["daily-build", "send", "collect", "summarize"])
    p.add_argument("--date")
    p.add_argument("--no-collect", action="store_true")
    p.add_argument("--force", action="store_true")
    p.add_argument("--limit", type=int, default=400)
    a = p.parse_args()
    day = date.fromisoformat(a.date) if a.date else None

    async with AsyncSessionLocal() as db:
        if a.cmd == "daily-build":
            _print("daily-build", await daily.build_daily(db, day, collect=not a.no_collect, force=a.force))
        elif a.cmd == "send":
            _print("send", await sender.send_daily(db, day))
        elif a.cmd == "collect":
            _print("collect", await collector.collect_all(db, via="manual"))
            _print("summarize", await summarizer.summarize_pending(db, limit=a.limit))
        elif a.cmd == "summarize":
            _print("summarize", await summarizer.summarize_pending(db, limit=a.limit))
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
