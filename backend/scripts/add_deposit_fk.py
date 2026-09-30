"""deposit_accounts.customer_id → clients.id FK 수동 추가 (docs/login_logic P0-2).

마이그레이션 y4d5e6p7f8k9 가 고아 행 때문에 FK 를 건너뛴 경우에만 사용.
먼저 scripts/permission_precheck.sql 4번으로 고아 행을 정리한 뒤 실행:
    python scripts/add_deposit_fk.py
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text  # noqa: E402

from app.db.session import engine  # noqa: E402

FK = "fk_deposit_accounts_customer_id_clients"


async def main() -> None:
    async with engine.begin() as conn:
        exists = (await conn.execute(text("SELECT 1 FROM pg_constraint WHERE conname = :n"), {"n": FK})).scalar()
        if exists:
            print("이미 FK 가 있습니다.")
            return
        orphans = (await conn.execute(text(
            "SELECT COUNT(*) FROM deposit_accounts d LEFT JOIN clients c ON c.id = d.customer_id WHERE c.id IS NULL"
        ))).scalar()
        if orphans:
            print(f"고객과 연결되지 않은 예수금 계좌가 {orphans}건 남아 있습니다. 정리 후 다시 실행하세요.")
            sys.exit(1)
        await conn.execute(text(
            f"ALTER TABLE deposit_accounts ADD CONSTRAINT {FK} FOREIGN KEY (customer_id) REFERENCES clients(id) ON DELETE CASCADE"
        ))
        print("FK 를 추가했습니다.")


if __name__ == "__main__":
    asyncio.run(main())
