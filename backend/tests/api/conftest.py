"""tests/api 공통 픽스처.

소유권 검증 헬퍼(IDOR 방지, P1-11/P1-12 보안 강화)는 실제 DB 조인이 필요한
통합테스트 대상이다. 이 디렉터리의 단위테스트는 db를 AsyncMock으로 주입하고
db.execute.side_effect 순서에 의존하므로, 헬퍼가 추가 쿼리를 소비하면
기존 테스트의 mock 시퀀스가 어긋난다. 여기서는 헬퍼를 no-op으로 우회한다.
"""
from unittest.mock import MagicMock

import pytest


@pytest.fixture(autouse=True)
def _bypass_ownership_checks(monkeypatch):
    """소유권 검증 헬퍼를 no-op으로 대체 (단위테스트 전용)."""

    async def _pass(*args, **kwargs):
        return MagicMock()

    async def _none(*args, **kwargs):
        return None

    targets = [
        ("app.api.v1.snapshots", ["_verify_account_owner", "_verify_snapshot_owner"]),
        ("app.api.v1.reports", ["_verify_client_owner"]),
        ("app.api.v1.client_portal", ["_verify_suggestion_owner"]),
    ]
    for module_path, names in targets:
        module = __import__(module_path, fromlist=names)
        for name in names:
            monkeypatch.setattr(module, name, _pass, raising=True)

    # 보고서 Claude 키 조회도 DB 쿼리를 소비하므로 None(=Gemini 폴백)으로 우회
    import app.api.v1.reports as _reports_mod

    monkeypatch.setattr(_reports_mod, "_get_claude_key", _none, raising=True)
    yield
