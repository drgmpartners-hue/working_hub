"""야간 일배치 — 전종목(한정 유니버스) 지표 사전계산 (08-stock-etf-recommend P5-R1).

장 마감 후 1회 실행: 유니버스 종목의 KIS 실데이터 지표를 계산해
- stock_daily_metrics 적재(스크리닝/추천 DB 조회용)
- score_snapshots 적재(비가격 축 사후검증 보정용)

⚠️ KIS 초당 제한 때문에 유니버스를 한정(테마 소속 + 큐레이션, 상한 max_codes).
   스케줄러 없이 스크립트로 실행 가능(Railway Cron / 작업 스케줄러).
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from sqlalchemy import select as _select

from app.models.stock_metrics import StockDailyMetric, ScoreSnapshot
from app.models.stock import StockTheme
from app.services import market_data_service, theme_scoring
from app.services.collectors.key_access import get_user_key
from app.services.collectors.kis_client import KISClient
from app.services.collectors.theme_mapping_collector import load_cached_map
from app.services.theme_stock_map import THEME_STOCKS

logger = logging.getLogger(__name__)


def build_universe(max_codes: int = 200) -> list[tuple[str, str]]:
    """배치 대상 종목 유니버스 (code, name). 수집 매핑 + 큐레이션, 중복 제거 후 상한."""
    seen: dict[str, str] = {}
    for members in load_cached_map().values():
        for m in members:
            seen.setdefault(m[0], m[1])
    for members in THEME_STOCKS.values():
        for code, name in members:
            seen.setdefault(code, name)
    return list(seen.items())[:max_codes]


async def run_batch(db: AsyncSession, user_id: str, max_codes: int = 200) -> dict:
    """유니버스 지표 계산 → metrics/snapshot 적재. 요약 반환."""
    creds = await get_user_key(db, user_id, "kis")
    if not creds:
        return {"ok": False, "reason": "KIS 키 없음", "processed": 0}

    client = KISClient(*creds)
    universe = build_universe(max_codes)
    today = date.today()
    processed = snap = 0

    for code, name in universe:
        try:
            d = await market_data_service.compute_metrics_dict(client, code)
        except Exception as e:
            logger.info("배치 계산 실패(무시) %s: %s", code, e)
            continue
        if not d:
            continue

        # --- stock_daily_metrics upsert ---
        existing = (
            await db.execute(
                select(StockDailyMetric).where(
                    and_(StockDailyMetric.code == code, StockDailyMetric.trade_date == today)
                )
            )
        ).scalar_one_or_none()
        fields = dict(
            name=name, close=d["close"], ma5=d["ma5"], ma20=d["ma20"], ma60=d["ma60"], ma120=d["ma120"],
            ma_alignment=d["ma_alignment"], golden_cross=d["golden_cross"], dead_cross=d["dead_cross"],
            per=d["per"], pbr=d["pbr"], roe=d["roe"],
            foreign_net=d["foreign_net"], institution_net=d["institution_net"],
            composite_score=d["composite"], valuation=d["valuation"], momentum=d["momentum"], supply=d["supply"],
            phase=d["phase"], return_1m=d["return_1m"], return_3m=d["return_3m"], return_6m=d["return_6m"],
        )
        if existing:
            for k, v in fields.items():
                setattr(existing, k, v)
        else:
            db.add(StockDailyMetric(code=code, trade_date=today, **fields))

        # --- score_snapshots (당일 1건) ---
        has_snap = (
            await db.execute(
                select(ScoreSnapshot).where(
                    and_(ScoreSnapshot.code == code, ScoreSnapshot.snapshot_date == today)
                )
            )
        ).scalar_one_or_none()
        if not has_snap:
            db.add(ScoreSnapshot(
                code=code, snapshot_date=today,
                momentum=d["momentum"], supply=d["supply"], valuation=d["valuation"],
                fundamentals=d["roe"], composite=d["composite"], phase=d["phase"],
                entry_price=d["close"],
            ))
            snap += 1
        processed += 1

    await db.commit()
    return {"ok": True, "processed": processed, "snapshots": snap, "universe": len(universe), "date": str(today)}


async def score_all_themes(db: AsyncSession, user_id: str) -> dict:
    """모든 테마의 5축 점수를 계산해 ai_score·phase 갱신 (목록이 클릭 없이 실점수).

    배치에서 종목 지표를 이미 계산했으므로 signals 캐시가 따뜻해 추가 호출 적음.
    """
    themes = (await db.execute(_select(StockTheme))).scalars().all()
    scored = 0
    for theme in themes:
        try:
            agg = await theme_scoring.aggregate_theme(db, user_id, theme.theme_name)
        except Exception as e:
            logger.info("테마 점수 실패(무시) %s: %s", theme.theme_name, e)
            continue
        if agg:
            theme.ai_score = agg["score"]
            theme.phase = agg["phase"]
            scored += 1
        else:
            # 미계산(배치 범위 밖) → placeholder 점수 제거해 목록 하위로 (실데이터 테마가 위로)
            theme.ai_score = None
            theme.phase = None
    await db.commit()
    return {"scored_themes": scored, "total_themes": len(themes)}


async def mature_snapshots(db: AsyncSession, user_id: str, horizon_days: int = 28) -> dict:
    """horizon 경과 + 미측정 스냅샷에 실현수익률 채움 (정답 라벨링)."""
    creds = await get_user_key(db, user_id, "kis")
    if not creds:
        return {"ok": False, "reason": "KIS 키 없음", "matured": 0}
    client = KISClient(*creds)
    cutoff = date.today() - timedelta(days=horizon_days)

    rows = (
        await db.execute(
            select(ScoreSnapshot).where(
                and_(ScoreSnapshot.horizon_return.is_(None), ScoreSnapshot.snapshot_date <= cutoff)
            ).limit(300)
        )
    ).scalars().all()

    matured = 0
    for snap in rows:
        try:
            info = await client.get_price_info(snap.code)
            cur = info.get("current_price")
            if cur and snap.entry_price:
                snap.horizon_return = round((cur - snap.entry_price) / snap.entry_price * 100, 2)
                snap.measured_at = datetime.now()
                matured += 1
        except Exception as e:
            logger.info("스냅샷 성숙 실패(무시) %s: %s", snap.code, e)
    await db.commit()
    return {"ok": True, "matured": matured}
