"""SECRET_KEY 교체 — 이미 보낸 브리핑·보고서 링크는 OLD_SECRET_KEYS 로 계속 열리고, 로그인 토큰은 새 키만 (2026-10-07)."""
import uuid
from datetime import date

import pytest

from app.core.config import settings
from app.services.company_report import mobile_link, report_share


@pytest.fixture
def secrets(monkeypatch):
    def set_(cur, old=""):
        monkeypatch.setattr(settings, "SECRET_KEY", cur)
        monkeypatch.setattr(settings, "OLD_SECRET_KEYS", old)
    return set_


def test_links_survive_secret_rotation(secrets):
    today = date(2026, 10, 7)
    subj, rid, cid = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    secrets("old-project-secret-2026")
    m = mobile_link.make("d", "2026-10-07", subj, today=today)
    r = report_share.make(rid, cid, today=today)

    # 새 키로 바꾸고 예전 값을 OLD_SECRET_KEYS 에 두면 이미 보낸 링크가 열린다
    secrets("n" * 48, old="old-project-secret-2026")
    assert mobile_link.parse("d", m, today=today) == ("2026-10-07", subj)
    assert report_share.parse(r, today=today) == (rid, cid)
    # 새로 만드는 링크는 새 키로 서명
    assert mobile_link.parse("d", mobile_link.make("d", "2026-10-07", subj, today=today), today=today)

    # 예전 값을 빼면 예전 링크는 거절, 위조 서명도 거절
    secrets("n" * 48)
    with pytest.raises(mobile_link.LinkError):
        mobile_link.parse("d", m, today=today)
    with pytest.raises(report_share.ShareError):
        report_share.parse(r, today=today)


def test_login_token_not_accepted_with_old_secret(secrets):
    from jose import JWTError, jwt

    from app.core.security import ALGORITHM, create_access_token

    secrets("old-project-secret-2026")
    tok = create_access_token("user-1")
    secrets("n" * 48, old="old-project-secret-2026")
    with pytest.raises(JWTError):
        jwt.decode(tok, settings.SECRET_KEY, algorithms=[ALGORITHM])
