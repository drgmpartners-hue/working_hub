"""야간 일배치 실행 스크립트.

사용: backend 에서  ./venv/Scripts/python.exe scripts/run_daily_batch.py [max_codes]
스케줄: Railway Cron 또는 Windows 작업 스케줄러로 장 마감 후(예: 18:00) 1회.
"""
import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select
from app.db.session import AsyncSessionLocal
from app.models.user_api_key import UserApiKey
from app.services import daily_batch


async def main():
    max_codes = int(sys.argv[1]) if len(sys.argv) > 1 else 200
    async with AsyncSessionLocal() as db:
        row = (await db.execute(select(UserApiKey).where(UserApiKey.provider == "kis"))).scalar_one_or_none()
        if not row:
            print("KIS 키 없음 — 중단")
            return
        uid = row.user_id
        print(f"배치 시작 (max_codes={max_codes}) ...")
        res = await daily_batch.run_batch(db, uid, max_codes=max_codes)
        print("배치 결과:", res)
        mat = await daily_batch.mature_snapshots(db, uid)
        print("스냅샷 성숙:", mat)


if __name__ == "__main__":
    asyncio.run(main())
