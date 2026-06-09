"""야간 일배치 실행 스크립트 (수집 → 배치 → 성숙, 자기완결형).

사용: backend 에서  python scripts/run_daily_batch.py [max_codes] [--no-collect]
스케줄: Railway Cron 또는 Windows 작업 스케줄러로 장 마감 후(예: 18:00) 1회.

Railway는 매 실행 컨테이너가 새로 떠 .cache가 없으므로 기본적으로 역설계 수집을 먼저 수행한다.
(--no-collect 로 수집 생략 가능 — 로컬에서 이미 수집한 경우)
"""
import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select
from app.db.session import AsyncSessionLocal
from app.models.user_api_key import UserApiKey
from app.services import daily_batch, stock_service
from app.services.collectors import theme_mapping_collector


async def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    max_codes = int(args[0]) if args else 200
    do_collect = "--no-collect" not in sys.argv

    async with AsyncSessionLocal() as db:
        row = (await db.execute(select(UserApiKey).where(UserApiKey.provider == "kis"))).scalar_one_or_none()
        if not row:
            print("KIS 키 없음 — 중단")
            return
        uid = row.user_id

        if do_collect:
            print("1) 역설계 매핑 수집(네이버 테마) ...")
            mapping = await theme_mapping_collector.collect(max_pages=7)
            added = await stock_service.upsert_themes_from_mapping(db, mapping)
            print(f"   수집 테마 {len(mapping)}개 (신규 {added})")

        print(f"2) 지표 배치 시작 (max_codes={max_codes}) ...")
        res = await daily_batch.run_batch(db, uid, max_codes=max_codes)
        print("   배치 결과:", res)

        print("3) 스냅샷 성숙(정답 라벨링) ...")
        mat = await daily_batch.mature_snapshots(db, uid)
        print("   스냅샷 성숙:", mat)


if __name__ == "__main__":
    asyncio.run(main())
