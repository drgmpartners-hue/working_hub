"""내 고객 관리 대시보드 — 실제 데이터 요약 (수정_tasks P2-8).

예전 화면은 숫자·이름이 모두 하드코딩된 샘플이었다. 이제 로그인한 사람이 볼 수 있는 고객(매니저 = 본인 담당,
대표 = 전체 또는 고른 매니저)의 실제 데이터로 계산한다.

- KPI: 관리 고객 수(이번 주 신규), 담당 AUM(계좌별 최신 스냅샷 총자산 합), 평균 수익률(최신 스냅샷 평가손익/매입 합),
       이번 달 통화 예약, 처리 대기(대기 중 통화 예약)
- AUM 추이: 최근 12개월 말 기준(그 달까지의 계좌별 최신 스냅샷 합)
- 주의 고객: 수익률 -5% 이하 / 90일 넘게 스냅샷 없음 / 대기 중 통화 예약
- 계좌 구성: 계좌 종류별 개수
- 오늘 일정: 오늘 희망일인 통화 예약
- 최근 활동: 고객 등록·스냅샷·문자 발송·통화 예약 최근 순
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import client_ids_subquery
from app.models.call_reservation import CallReservation
from app.models.client import Client, ClientAccount
from app.models.message_log import MessageLog
from app.models.portfolio_suggestion import PortfolioSuggestion
from app.models.snapshot import PortfolioSnapshot

ACCOUNT_LABEL = {"irp": "IRP", "pension": "연금저축", "pension_hold": "연금저축(거치)", "retirement": "퇴직연금",
                 "stock": "주식", "other": "기타"}
RISK_RATE = -5.0       # 이 수익률(%) 이하면 '위험'
STALE_DAYS = 90        # 이 기간 넘게 스냅샷이 없으면 '연락 필요'


def _assets(s: PortfolioSnapshot) -> float:
    if s.total_assets is not None:
        return float(s.total_assets)
    return float(s.total_evaluation or 0) + float(s.deposit_amount or 0) + float(s.foreign_deposit_amount or 0)


def _month_ends(today: date, n: int = 12) -> list[date]:
    out = []
    y, m = today.year, today.month
    for _ in range(n):
        nxt = date(y + (m == 12), m % 12 + 1, 1)
        out.append(min(nxt - timedelta(days=1), today))
        y, m = (y - 1, 12) if m == 1 else (y, m - 1)
    return list(reversed(out))


async def summary(db: AsyncSession, user, manager_id: Optional[str] = None, today: Optional[date] = None) -> dict:
    today = today or date.today()
    sub = client_ids_subquery(user, manager_id)

    cstmt = select(Client.id, Client.name, Client.created_at)
    if sub is not None:
        cstmt = cstmt.where(Client.id.in_(sub))
    clients = (await db.execute(cstmt)).all()
    names = {cid: name for cid, name, _ in clients}
    cids = list(names)
    week_ago = datetime.combine(today - timedelta(days=7), datetime.min.time())
    new_week = sum(1 for _, _, ca in clients if ca and ca >= week_ago)

    accounts = (await db.execute(select(ClientAccount.id, ClientAccount.client_id, ClientAccount.account_type)
                                 .where(ClientAccount.client_id.in_(cids)))).all() if cids else []
    acc_client = {aid: cid for aid, cid, _ in accounts}
    type_count: dict[str, int] = defaultdict(int)
    for _, _, t in accounts:
        type_count[t or "other"] += 1

    snaps = (await db.execute(select(PortfolioSnapshot).where(PortfolioSnapshot.client_account_id.in_(list(acc_client)))
                              .order_by(PortfolioSnapshot.snapshot_date))).scalars().all() if acc_client else []
    by_acc: dict[str, list[PortfolioSnapshot]] = defaultdict(list)
    for s in snaps:
        by_acc[s.client_account_id].append(s)
    latest = {aid: ss[-1] for aid, ss in by_acc.items()}

    aum = sum(_assets(s) for s in latest.values())
    purch = sum(float(s.total_purchase or 0) for s in latest.values() if (s.total_purchase or 0) > 0)
    evals = sum(float(s.total_evaluation or 0) for s in latest.values() if (s.total_purchase or 0) > 0)
    avg_rate = (evals - purch) / purch * 100 if purch > 0 else None

    # AUM 추이: 월말마다 계좌별 그 날짜까지의 최신 스냅샷 합
    trend = []
    for me in _month_ends(today):
        tot = 0.0
        for ss in by_acc.values():
            last = None
            for s in ss:
                if s.snapshot_date <= me:
                    last = s
                else:
                    break
            if last is not None:
                tot += _assets(last)
        trend.append({"month": me.strftime("%Y-%m"), "label": str(me.month), "aum": round(tot)})
    prev_aum = trend[-2]["aum"] if len(trend) >= 2 else 0
    aum_change_pct = ((aum - prev_aum) / prev_aum * 100) if prev_aum > 0 else None

    # 통화 예약(제안 → 계좌 → 고객 경유로 범위 제한)
    rstmt = (select(CallReservation, PortfolioSuggestion.account_id)
             .join(PortfolioSuggestion, PortfolioSuggestion.id == CallReservation.suggestion_id))
    rstmt = rstmt.where(PortfolioSuggestion.account_id.in_(list(acc_client))) if acc_client else rstmt.where(False)
    reservations = (await db.execute(rstmt)).all()
    month_start = datetime(today.year, today.month, 1)
    month_res = sum(1 for r, _ in reservations if r.created_at and r.created_at >= month_start)
    pending = [(r, a) for r, a in reservations if (r.status or "pending") == "pending"]

    # 주의 고객
    alerts: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for aid, s in latest.items():
        cid = acc_client.get(aid)
        rate = s.total_return_rate
        if rate is None and (s.total_purchase or 0) > 0:
            rate = (float(s.total_evaluation or 0) - float(s.total_purchase)) / float(s.total_purchase) * 100
        if rate is not None and rate <= RISK_RATE and (cid, "risk") not in seen:
            seen.add((cid, "risk"))
            alerts.append({"client_id": cid, "name": names.get(cid, ""), "kind": "neg", "badge": "위험",
                           "message": f"평가 수익률 {rate:.1f}% — 상담 권장", "sort": rate})
    stale_cut = today - timedelta(days=STALE_DAYS)
    last_snap_by_client: dict[str, date] = {}
    for aid, s in latest.items():
        cid = acc_client.get(aid)
        if cid and (cid not in last_snap_by_client or s.snapshot_date > last_snap_by_client[cid]):
            last_snap_by_client[cid] = s.snapshot_date
    for cid, d in last_snap_by_client.items():
        if d < stale_cut:
            alerts.append({"client_id": cid, "name": names.get(cid, ""), "kind": "warn", "badge": "연락 필요",
                           "message": f"마지막 분석 {d.isoformat()} — {(today - d).days}일 지남", "sort": 0})
    for r, aid in pending[:10]:
        cid = acc_client.get(aid)
        alerts.append({"client_id": cid, "name": names.get(cid, r.client_name or ""), "kind": "info", "badge": "통화 예약",
                       "message": f"희망 {r.preferred_date.isoformat()} {r.preferred_time} — 확인 필요", "sort": 1})
    order = {"neg": 0, "info": 1, "warn": 2}
    alerts.sort(key=lambda a: (order[a["kind"]], a["sort"]))

    schedule = sorted(
        [{"time": r.preferred_time, "title": f"{names.get(acc_client.get(aid), r.client_name or '고객')} 통화 예약",
          "sub": "확인 대기" if (r.status or "pending") == "pending" else r.status}
         for r, aid in reservations if r.preferred_date == today],
        key=lambda x: x["time"])

    # 최근 활동
    feed: list[dict] = []
    for cid, name, ca in clients:
        if ca:
            feed.append({"kind": "client", "text": f"신규 고객 {name} 등록", "at": ca})
    for s in sorted(snaps, key=lambda s: s.created_at or datetime.min, reverse=True)[:10]:
        feed.append({"kind": "snapshot", "text": f"{names.get(acc_client.get(s.client_account_id), '')} 포트폴리오 분석 ({s.snapshot_date.isoformat()})",
                     "at": s.created_at})
    if cids:
        for m in (await db.execute(select(MessageLog).where(MessageLog.client_id.in_(cids))
                                   .order_by(MessageLog.sent_at.desc()).limit(10))).scalars().all():
            feed.append({"kind": "message", "text": f"{names.get(m.client_id, '')} 문자 발송 — {m.message_summary}", "at": m.sent_at})
    for r, aid in reservations:
        if r.created_at:
            feed.append({"kind": "reservation", "text": f"{names.get(acc_client.get(aid), r.client_name or '')} 통화 예약 접수", "at": r.created_at})
    feed = [f for f in feed if f["at"]]
    feed.sort(key=lambda f: f["at"], reverse=True)

    return {
        "is_sample": False,
        "kpi": {
            "clients": len(cids), "new_clients_week": new_week,
            "aum": round(aum), "aum_change_pct": round(aum_change_pct, 1) if aum_change_pct is not None else None,
            "avg_return_rate": round(avg_rate, 2) if avg_rate is not None else None,
            "reservations_month": month_res, "pending": len(pending),
            "accounts": len(accounts), "accounts_with_snapshot": len(latest),
        },
        "aum_trend": trend,
        "alerts": [{k: v for k, v in a.items() if k != "sort"} for a in alerts[:6]],
        "alerts_total": len(alerts),
        "account_types": [{"type": t, "label": ACCOUNT_LABEL.get(t, t), "count": n}
                          for t, n in sorted(type_count.items(), key=lambda x: -x[1])],
        "schedule": schedule,
        "feed": [{"kind": f["kind"], "text": f["text"], "at": f["at"].isoformat()} for f in feed[:8]],
    }
