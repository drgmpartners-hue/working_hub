"""보안 정비 (수정_tasks P2-1·P1-20·P2-9·P1-22).

- P2-1: 암호화 전용 ENCRYPTION_KEY, 예전 두 방식(A: sha256(SECRET_KEY), B: SECRET_KEY 앞 32자)으로 저장된 값도 읽기,
        새 키로 다시 암호화(rotate_all), 운영에서 약한 키면 기동 중단
- P1-20: 포털 본인 확인 잠금을 DB 로(없는 링크는 기록 안 함, 3회 실패 → 30분)
- P2-9: 포털 JWT ↔ 주소 링크 열쇠·지금 링크 대조, 고유번호 없는 고객 차단, 용도(scope) 분리
- P1-22: 통화 예약은 담당 고객 것만
"""
import base64
import uuid
from datetime import date, datetime, timedelta

import pytest
from cryptography.fernet import Fernet, InvalidToken

from app.core import encryption
from app.core.config import settings
from tests.test_permissions import PG, env  # noqa: F401


def _legacy_a(secret: str, plain: str) -> str:
    return Fernet(encryption.derive_key(secret)).encrypt(plain.encode()).decode()


def _legacy_b(secret: str, plain: str) -> str:
    key = base64.urlsafe_b64encode(secret[:32].ljust(32, "0").encode())
    return Fernet(key).encrypt(plain.encode()).decode()


@pytest.fixture
def keys(monkeypatch):
    """설정을 바꾸고 암호화 키를 다시 만든다. 끝나면 원래대로."""
    def set_keys(secret="s" * 40, enc="", old=""):
        monkeypatch.setattr(settings, "SECRET_KEY", secret)
        monkeypatch.setattr(settings, "ENCRYPTION_KEY", enc)
        monkeypatch.setattr(settings, "OLD_ENCRYPTION_KEYS", old)
        encryption.reset_cache()
    yield set_keys
    monkeypatch.undo()
    encryption.reset_cache()


# --------------------------------------------------------------------------- P2-1 암호화

def test_reads_both_legacy_formats_and_writes_with_encryption_key(keys):
    secret = "legacy-secret-" + "x" * 30
    tok_a = _legacy_a(secret, "sk-api-1234")
    tok_b = _legacy_b(secret, "900101-1234567")

    keys(secret=secret, enc="")  # ENCRYPTION_KEY 없음: 예전처럼 동작
    assert encryption.decrypt(tok_a) == "sk-api-1234"
    assert encryption.decrypt_ssn(tok_b) == "900101-1234567"
    assert not encryption.needs_rotation(encryption.encrypt("x"))  # 지금 키 = 예전 방식 A

    keys(secret=secret, enc="enc-key-" + "y" * 40)
    new = encryption.encrypt("hello")
    with pytest.raises(InvalidToken):  # 새 값은 SECRET_KEY 로는 못 푼다
        Fernet(encryption.derive_key(secret)).decrypt(new.encode())
    assert encryption.decrypt(new) == "hello"
    assert encryption.decrypt(tok_a) == "sk-api-1234" and encryption.decrypt_ssn(tok_b) == "900101-1234567"
    assert encryption.needs_rotation(tok_a) and not encryption.needs_rotation(new)
    rot = encryption.rotate(tok_b)
    assert rot and not encryption.needs_rotation(rot) and encryption.decrypt(rot) == "900101-1234567"
    assert encryption.rotate(new) is None

    # SECRET_KEY 를 바꿔도 새 키로 암호화된 값은 읽힌다(분리의 목적)
    keys(secret="other-secret-" + "z" * 30, enc="enc-key-" + "y" * 40)
    assert encryption.decrypt(new) == "hello" and encryption.decrypt(rot) == "900101-1234567"
    with pytest.raises(InvalidToken):
        encryption.decrypt(tok_a)

    # 키를 바꿀 때는 이전 키를 OLD_ENCRYPTION_KEYS 에
    keys(secret=secret, enc="brand-new-" + "w" * 40, old="enc-key-" + "y" * 40)
    assert encryption.decrypt(new) == "hello" and encryption.needs_rotation(new)


def test_api_key_helpers_share_one_cipher(keys):
    from app.api.v1 import user_api_keys
    from app.core.security import decrypt_api_key, encrypt_api_key

    keys(secret="t" * 40, enc="e" * 40)
    a = encrypt_api_key("k1")
    assert user_api_keys._decrypt(a) == "k1" and decrypt_api_key(user_api_keys._encrypt("k2")) == "k2"
    assert encryption.decrypt_ssn(a) == "k1"


def test_startup_checks(keys, monkeypatch):
    monkeypatch.delenv("RAILWAY_ENVIRONMENT", raising=False)
    monkeypatch.delenv("RAILWAY_ENVIRONMENT_NAME", raising=False)
    monkeypatch.setattr(settings, "APP_ENV", "")
    keys(secret="changeme", enc="")
    encryption.check_startup()  # 개발: 경고만
    fatal, warn = encryption.startup_problems()
    assert not fatal and any("SECRET_KEY" in w for w in warn) and any("ENCRYPTION_KEY" in w for w in warn)

    monkeypatch.setenv("RAILWAY_ENVIRONMENT_NAME", "production")
    with pytest.raises(RuntimeError):
        encryption.check_startup()
    keys(secret="q" * 40, enc="short")
    with pytest.raises(RuntimeError):
        encryption.check_startup()
    keys(secret="q" * 40, enc="")
    encryption.check_startup()  # ENCRYPTION_KEY 없음은 경고(전환 전 운영이 멈추지 않게)
    keys(secret="q" * 40, enc="q" * 40)
    fatal, warn = encryption.startup_problems()
    assert not fatal and any("같습니다" in w for w in warn)


@pytest.mark.skipif(not PG, reason="PERM_PG_URL 없음(실제 PostgreSQL 필요)")
async def test_rotate_all_reencrypts_stored_values(env, keys):  # noqa: F811
    from sqlalchemy import select

    from app.models.client import Client
    from app.models.user_api_key import UserApiKey
    from app.services import settings_store

    Session, d = env["Session"], env["d"]
    secret = settings.SECRET_KEY
    async with Session() as db:
        cl = await db.get(Client, d["client_A"])
        cl.ssn_encrypted = _legacy_b(secret, "800101-1111111")
        k = UserApiKey(user_id=d["A"], provider="claude", api_key=_legacy_a(secret, "sk-1"), api_secret=_legacy_a(secret, "sec"))
        db.add(k)
        await db.commit()
        kid = k.id

    keys(secret=secret, enc="rotate-test-key-" + uuid.uuid4().hex)
    async with Session() as db:
        await settings_store.set_value(db, encryption.FP_KEY, "old")
        res = await encryption.rotate_if_needed(db)
        assert res["rotated"] >= 3 and res["tables"]["Client"]["rotated"] >= 1
        assert await settings_store.get(db, encryption.FP_KEY) == encryption.fingerprint()
        assert await encryption.rotate_if_needed(db) is None  # 같은 키면 다시 안 함
        again = await encryption.rotate_all(db)
        assert again["rotated"] == 0

    async with Session() as db:
        cl = await db.get(Client, d["client_A"])
        k = (await db.execute(select(UserApiKey).where(UserApiKey.id == kid))).scalar_one()
        primary = Fernet(encryption.primary_key())
        assert primary.decrypt(cl.ssn_encrypted.encode()).decode() == "800101-1111111"
        assert primary.decrypt(k.api_key.encode()).decode() == "sk-1" and primary.decrypt(k.api_secret.encode()).decode() == "sec"
        await db.delete(k)
        await db.commit()


# --------------------------------------------------------------------------- P1-20·P2-9 포털

async def _portal_client(Session, client_id: str, code="123456", phone="010-1111-2222"):
    from app.models.client import Client

    async with Session() as db:
        cl = await db.get(Client, client_id)
        cl.unique_code, cl.phone, cl.portal_failures, cl.portal_locked_until = code, phone, 0, None
        cl.portal_token = str(uuid.uuid4())
        await db.commit()
        return cl.portal_token


@pytest.mark.skipif(not PG, reason="PERM_PG_URL 없음(실제 PostgreSQL 필요)")
async def test_portal_lockout_in_db(env):  # noqa: F811
    from app.models.client import Client

    c, d, Session = env["c"], env["d"], env["Session"]
    tok = await _portal_client(Session, d["client_A"], code=f"{uuid.uuid4().int % 900000 + 100000}")
    async with Session() as db:
        code = (await db.get(Client, d["client_A"])).unique_code
    good = {"birth_date": "1980-01-01", "phone": "01011112222", "unique_code": code}
    bad = {**good, "phone": "01099999999"}
    assert (await c.post(f"/client-portal/{tok}/verify", json=bad)).status_code == 401
    assert (await c.post(f"/client-portal/{tok}/verify", json=bad)).status_code == 401
    assert (await c.post(f"/client-portal/{tok}/verify", json=bad)).status_code == 429  # 3번째에 잠김
    assert (await c.post(f"/client-portal/{tok}/verify", json=good)).status_code == 429  # 맞아도 잠김 중
    async with Session() as db:
        cl = await db.get(Client, d["client_A"])
        assert cl.portal_locked_until and cl.portal_failures == 0
        cl.portal_locked_until = datetime.utcnow() - timedelta(minutes=1)  # 30분 지남
        await db.commit()
    assert (await c.post(f"/client-portal/{tok}/verify", json=bad)).status_code == 401
    r = await c.post(f"/client-portal/{tok}/verify", json=good)
    assert r.status_code == 200 and r.json()["access_token"]
    async with Session() as db:
        cl = await db.get(Client, d["client_A"])
        assert cl.portal_failures == 0 and cl.portal_locked_until is None
    # 없는 링크는 404, 아무것도 기록하지 않는다
    for _ in range(5):
        assert (await c.post(f"/client-portal/{uuid.uuid4()}/verify", json=good)).status_code == 404


@pytest.mark.skipif(not PG, reason="PERM_PG_URL 없음(실제 PostgreSQL 필요)")
async def test_portal_requires_unique_code_and_matching_link(env):  # noqa: F811
    from app.models.client import Client

    c, d, Session, hdr = env["c"], env["d"], env["Session"], env["hdr"]
    tok_a = await _portal_client(Session, d["client_A"], code=f"{uuid.uuid4().int % 900000 + 100000}")
    tok_b = await _portal_client(Session, d["client_B"], code=f"{uuid.uuid4().int % 900000 + 100000}")
    async with Session() as db:
        cl = await db.get(Client, d["client_A"])
        code_a = cl.unique_code
        cl.unique_code = None  # 고유번호 없는 고객: 빈 값끼리 맞아 버리던 구멍
        await db.commit()
    body = {"birth_date": "1980-01-01", "phone": "010-1111-2222", "unique_code": ""}
    r = await c.post(f"/client-portal/{tok_a}/verify", json=body)
    assert r.status_code == 403 and "고유번호" in r.json()["detail"]
    async with Session() as db:
        (await db.get(Client, d["client_A"])).unique_code = code_a
        await db.commit()
    jwt_a = (await c.post(f"/client-portal/{tok_a}/verify", json={**body, "unique_code": code_a})).json()["access_token"]
    h = {"Authorization": f"Bearer {jwt_a}"}
    assert (await c.get(f"/client-portal/{tok_a}/snapshots", headers=h)).status_code == 200
    assert (await c.get(f"/client-portal/{tok_b}/snapshots", headers=h)).status_code == 401  # 남의 링크 주소
    # 포털 토큰으로 직원 API 불가, 직원 토큰으로 포털 불가
    assert (await c.get("/clients", headers=h)).status_code == 401
    assert (await c.get(f"/client-portal/{tok_a}/snapshots", headers=hdr(d["A"]))).status_code == 401
    # 링크를 새로 만들면 예전 JWT 무효
    async with Session() as db:
        (await db.get(Client, d["client_A"])).portal_token = str(uuid.uuid4())
        await db.commit()
    assert (await c.get(f"/client-portal/{tok_a}/snapshots", headers=h)).status_code == 401


# --------------------------------------------------------------------------- P1-22 통화 예약

@pytest.mark.skipif(not PG, reason="PERM_PG_URL 없음(실제 PostgreSQL 필요)")
async def test_call_reservations_scoped_to_manager(env):  # noqa: F811
    from app.models.call_reservation import CallReservation
    from app.models.portfolio_suggestion import PortfolioSuggestion

    c, d, Session, hdr = env["c"], env["d"], env["Session"], env["hdr"]
    async with Session() as db:
        s = PortfolioSuggestion(account_id=d["account_A"], snapshot_id=str(uuid.uuid4()), suggested_weights={},
                                expires_at=datetime.utcnow() + timedelta(days=7), created_by=d["A"])
        db.add(s)
        await db.flush()
        r = CallReservation(suggestion_id=s.id, client_name="고객A", phone="010", preferred_date=date(2026, 10, 5),
                            preferred_time="10:00", status="pending")
        db.add(r)
        await db.commit()
        rid, sid = r.id, s.id
    ids_a = [x["id"] for x in (await c.get("/call-reservations", headers=hdr(d["A"]))).json()["items"]]
    ids_b = [x["id"] for x in (await c.get("/call-reservations", headers=hdr(d["B"]))).json()["items"]]
    ids_o = [x["id"] for x in (await c.get("/call-reservations", headers=hdr(d["owner"]))).json()["items"]]
    assert rid in ids_a and rid not in ids_b and rid in ids_o
    assert (await c.put(f"/call-reservations/{rid}", headers=hdr(d["B"]), json={"status": "confirmed"})).status_code == 404
    assert (await c.put(f"/call-reservations/{rid}", headers=hdr(d["A"]), json={"status": "confirmed"})).status_code == 200
    async with Session() as db:
        await db.delete(await db.get(CallReservation, rid))
        await db.delete(await db.get(PortfolioSuggestion, sid))
        await db.commit()


@pytest.mark.skipif(not PG, reason="PERM_PG_URL 없음(실제 PostgreSQL 필요)")
async def test_security_status_owner_only_and_no_secrets(env, keys):  # noqa: F811
    c, d, hdr = env["c"], env["d"], env["hdr"]
    assert (await c.get("/admin/security-status", headers=hdr(d["A"]))).status_code == 403
    keys(secret=settings.SECRET_KEY, enc="")
    r = (await c.get("/admin/security-status", headers=hdr(d["owner"]))).json()
    assert r["encryption_key_set"] is False and r["ok"] is False and any("ENCRYPTION_KEY" in p for p in r["problems"])
    enc = "status-key-" + uuid.uuid4().hex + "x" * 10
    keys(secret="s" * 40, enc=enc)
    r2 = await c.get("/admin/security-status", headers=hdr(d["owner"]))
    assert enc not in r2.text and "s" * 40 not in r2.text and r2.json()["encryption_key_set"] is True
