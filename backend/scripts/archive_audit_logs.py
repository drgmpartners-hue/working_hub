"""감사 로그 보존 배치 (docs/login_logic P6, 지시서 10.4).

보존 기간(기본 365일)이 지난 audit_logs 를 월 단위 JSONL.gz 파일로 내보낸 뒤 삭제한다.
기본은 미리보기(dry-run) — 실제로 지우려면 --apply.

사용: backend 에서
  python scripts/archive_audit_logs.py                      # 대상 건수만 확인
  python scripts/archive_audit_logs.py --apply              # 내보내기 + 삭제
  python scripts/archive_audit_logs.py --days 400 --out /data/audit_archive --apply
Railway Cron 예: 매월 1일 04:30 KST (cron: 30 19 1 * *)  →  python scripts/archive_audit_logs.py --apply
"""
import argparse
import asyncio
import gzip
import json
import os
import sys
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import delete, func, select  # noqa: E402

from app.db.session import AsyncSessionLocal  # noqa: E402
from app.models.audit_log import AuditLog  # noqa: E402

COLUMNS = [c.name for c in AuditLog.__table__.columns]


async def run(days: int, out_dir: str, apply: bool) -> None:
    cutoff = datetime.utcnow() - timedelta(days=days)
    async with AsyncSessionLocal() as db:
        total = int((await db.execute(select(func.count()).select_from(AuditLog).where(AuditLog.created_at < cutoff))).scalar_one())
        print(f"보존 기간 {days}일 · 기준 {cutoff:%Y-%m-%d} 이전 기록 {total}건")
        if not total or not apply:
            if total and not apply:
                print("미리보기만 했습니다. 내보내고 지우려면 --apply 를 붙이세요.")
            return
        os.makedirs(out_dir, exist_ok=True)
        rows = (await db.execute(select(AuditLog).where(AuditLog.created_at < cutoff).order_by(AuditLog.created_at))).scalars().all()
        by_month: dict[str, list] = {}
        for r in rows:
            by_month.setdefault(r.created_at.strftime("%Y-%m"), []).append(
                {k: (v.isoformat() if isinstance(v, datetime) else v) for k, v in ((c, getattr(r, c)) for c in COLUMNS)}
            )
        for month, items in by_month.items():
            path = os.path.join(out_dir, f"audit_logs_{month}.jsonl.gz")
            with gzip.open(path, "at", encoding="utf-8") as f:  # 같은 달 파일이 있으면 이어 쓴다
                for it in items:
                    f.write(json.dumps(it, ensure_ascii=False) + "\n")
            print(f"  {path}: {len(items)}건")
        await db.execute(delete(AuditLog).where(AuditLog.created_at < cutoff))
        await db.commit()
        print(f"삭제 완료: {total}건")


def main() -> None:
    ap = argparse.ArgumentParser(description="감사 로그 보존 배치")
    ap.add_argument("--days", type=int, default=365, help="보존 일수 (기본 365, 최소 365 권장)")
    ap.add_argument("--out", default=os.environ.get("AUDIT_ARCHIVE_DIR", "audit_archive"), help="내보낼 폴더")
    ap.add_argument("--apply", action="store_true", help="실제로 내보내고 삭제")
    a = ap.parse_args()
    if a.days < 365:
        print("보존 기간은 최소 1년(365일)입니다.")
        sys.exit(1)
    asyncio.run(run(a.days, a.out, a.apply))


if __name__ == "__main__":
    main()
