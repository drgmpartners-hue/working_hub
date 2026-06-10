"""야간 일배치 실행 스크립트 (자기완결형).

순서: ① 역설계 수집 → ② 테마 반영 → ③ 종목 지표 → ④ 테마 5축 점수 → ⑤ 스냅샷 성숙 → ⑥ 리포트 이메일

사용: backend 에서  python scripts/run_daily_batch.py [max_codes] [--no-collect]
스케줄: Railway Cron 또는 작업 스케줄러로 장 마감 후(예: 평일 18:00) 1회.
"""
import asyncio
import sys
import os
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select
from app.db.session import AsyncSessionLocal
from app.models.user_api_key import UserApiKey
from app.services import daily_batch, stock_service, stock_report, email_service, settings_store
from app.services.collectors import theme_mapping_collector
from app.core.config import settings


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
            print("① 역설계 매핑 수집(네이버 테마) ...")
            mapping = await theme_mapping_collector.collect(max_pages=7)
            added = await stock_service.upsert_themes_from_mapping(db, mapping)
            print(f"   수집 테마 {len(mapping)}개 (신규 {added})")

        print("② 테마 반영(큐레이션 보강) ...")
        await stock_service.populate_themes(db)

        print(f"③ 종목 지표 배치 (max_codes={max_codes}) ...")
        res = await daily_batch.run_batch(db, uid, max_codes=max_codes)
        print("   배치 결과:", res)

        print("④ 테마 5축 점수 계산 ...")
        ts = await daily_batch.score_all_themes(db, uid)
        print("   테마 점수:", ts)

        print("⑤ 스냅샷 성숙(정답 라벨링) ...")
        mat = await daily_batch.mature_snapshots(db, uid)
        print("   스냅샷 성숙:", mat)

        print("⑥ 리포트 이메일 ...")
        enabled = await settings_store.get_bool(db, settings_store.REPORT_EMAIL_ENABLED, default=False)
        if not enabled:
            print("   리포트 이메일 OFF — 발송 생략 (화면에서 토글 ON 시 발송)")
        else:
            recipient = await settings_store.get(db, settings_store.REPORT_EMAIL_RECIPIENT) or settings.STAFF_EMAIL
            data = await stock_report.build_report_data(db)
            html = stock_report.render_html(data)
            sent = await email_service.send_stock_report(recipient, html, data["date"])
            print(f"   리포트 발송: {'성공' if sent else 'mock/생략'} → {recipient}")

        # 마지막 배치(데이터 갱신) 시각 기록 → 화면 상태 표시용
        await settings_store.set_value(db, "last_batch_at", datetime.now(timezone.utc).isoformat())
        print("배치 완료.")


if __name__ == "__main__":
    asyncio.run(main())
