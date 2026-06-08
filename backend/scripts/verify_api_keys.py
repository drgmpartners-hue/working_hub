"""저장된 외부 API 키 검증 스크립트 (일회성).

DB(user_api_keys)에서 키를 읽어 복호화 후 실제 API를 호출해 유효성을 확인한다.
사용: backend 디렉토리에서  ./venv/Scripts/python.exe scripts/verify_api_keys.py
"""
import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select
from app.db.session import AsyncSessionLocal
from app.models.user_api_key import UserApiKey
from app.api.v1.user_api_keys import (
    _decrypt,
    _test_kis,
    _test_dart,
    _test_naver_search,
    _test_kiwoom,
    _test_claude,
    _test_gemini,
    _test_notion,
)

TARGET = ["kis", "dart", "naver_search", "kiwoom", "claude", "gemini", "notion"]


async def _run_test(provider: str, api_key: str, api_secret: str):
    if provider == "kis":
        return await _test_kis(api_key, api_secret)
    if provider == "dart":
        return await _test_dart(api_key)
    if provider == "naver_search":
        return await _test_naver_search(api_key, api_secret)
    if provider == "kiwoom":
        return await _test_kiwoom(api_key, api_secret)
    if provider == "claude":
        return await _test_claude(api_key)
    if provider == "gemini":
        return await _test_gemini(api_key)
    if provider == "notion":
        return await _test_notion(api_key)
    return None


async def main():
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(select(UserApiKey))).scalars().all()

    if not rows:
        print("저장된 API 키가 DB에 없습니다. (설정>API 관리에서 먼저 저장)")
        return

    print(f"저장된 키 {len(rows)}개 발견. 검증 시작\n" + "=" * 60)
    for r in rows:
        provider = r.provider
        try:
            api_key = _decrypt(r.api_key)
            api_secret = _decrypt(r.api_secret) if r.api_secret else ""
        except Exception as e:
            print(f"[{provider:14}] 복호화 실패: {e}  (SECRET_KEY 불일치 가능)")
            continue

        if provider not in TARGET:
            print(f"[{provider:14}] 테스트 미지원")
            continue

        try:
            result = await _run_test(provider, api_key, api_secret)
            mark = "OK  " if result and result.success else "FAIL"
            msg = result.message if result else "테스트 함수 없음"
            print(f"[{provider:14}] {mark} | active={r.is_active} | {msg}")
        except Exception as e:
            print(f"[{provider:14}] ERROR | {e}")

    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
