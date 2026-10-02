"""저장 데이터 암호화 — 한 곳에서만 키를 만든다 (수정_tasks P2-1).

예전에는 두 가지 방식이 섞여 있었다(둘 다 로그인 서명용 SECRET_KEY 에서 키를 뽑음).
  - 방식 A: sha256(SECRET_KEY)               → API 키(설정·사용자 키), 솔라피
  - 방식 B: SECRET_KEY 앞 32자(+'0' 채움)    → 고객 주민번호
SECRET_KEY 를 바꾸면 저장된 주민번호·API 키를 모두 못 읽게 되는 구조였다.

지금
  - 암호화 전용 키 ENCRYPTION_KEY(환경변수). 키 만드는 방식은 sha256 하나로 통일.
  - 새로 저장하는 값은 ENCRYPTION_KEY 로 암호화한다(없으면 예전 방식 A — 운영 전환 전까지 그대로 동작).
  - 읽을 때는 ENCRYPTION_KEY → OLD_ENCRYPTION_KEYS(쉼표 구분, 키 교체 때) → 예전 방식 A·B 순으로 시도(MultiFernet).
  - 서버가 뜰 때 ENCRYPTION_KEY 가 처음이거나 바뀌었으면 저장된 값을 모두 새 키로 다시 암호화한다(rotate_all).
    끝나면 app_settings 'encryption_primary_fp' 에 키 지문을 남겨 다음 기동 때는 건너뛴다.
  - 운영(Railway)에서 SECRET_KEY 가 기본값·너무 짧으면 서버가 뜨지 않는다(check_startup).
"""
from __future__ import annotations

import base64
import hashlib
import logging
import os
from functools import lru_cache
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken, MultiFernet

from app.core.config import settings

logger = logging.getLogger(__name__)

WEAK_SECRETS = {"", "changeme", "change-me", "change_me", "secret", "secret_key", "your-secret-key", "dev", "test"}
MIN_SECRET_LEN = 32
FP_KEY = "encryption_primary_fp"
ROTATION_KEY = "encryption_rotation_result"


def derive_key(secret: str) -> bytes:
    """비밀 문자열 → Fernet 키(sha256 32바이트, URL-safe base64). 모든 암호화가 이 방식 하나를 쓴다."""
    return base64.urlsafe_b64encode(hashlib.sha256(secret.encode("utf-8")).digest())


def _legacy_ssn_key(secret: str) -> Optional[bytes]:
    """예전 주민번호 방식 B(읽기 전용). 32바이트가 안 되면(한글 등) 쓸 수 없으니 None."""
    raw = secret[:32].ljust(32, "0").encode("utf-8")
    return base64.urlsafe_b64encode(raw) if len(raw) == 32 else None


def _old_keys() -> list[str]:
    return [k.strip() for k in (settings.OLD_ENCRYPTION_KEYS or "").split(",") if k.strip()]


def primary_key() -> bytes:
    return derive_key(settings.ENCRYPTION_KEY) if settings.ENCRYPTION_KEY else derive_key(settings.SECRET_KEY)


@lru_cache(maxsize=1)
def _cipher() -> MultiFernet:
    keys: list[bytes] = [primary_key()]
    for k in _old_keys():
        keys.append(derive_key(k))
    keys.append(derive_key(settings.SECRET_KEY))          # 예전 방식 A
    legacy_b = _legacy_ssn_key(settings.SECRET_KEY)      # 예전 방식 B(주민번호)
    if legacy_b:
        keys.append(legacy_b)
    uniq: list[bytes] = []
    for k in keys:
        if k not in uniq:
            uniq.append(k)
    return MultiFernet([Fernet(k) for k in uniq])


def reset_cache() -> None:
    """설정을 바꾼 뒤(테스트 등) 키를 다시 만들게 한다."""
    _cipher.cache_clear()


def encrypt(plain: str) -> str:
    return _cipher().encrypt(plain.encode("utf-8")).decode("utf-8")


def decrypt(token: str) -> str:
    """복호화. 어떤 키로도 안 풀리면 cryptography.fernet.InvalidToken."""
    return _cipher().decrypt(token.encode("utf-8")).decode("utf-8")


def needs_rotation(token: str) -> bool:
    """지금 키(primary)로 암호화된 값이 아니면 True."""
    try:
        Fernet(primary_key()).decrypt(token.encode("utf-8"))
        return False
    except InvalidToken:
        return True


def rotate(token: str) -> Optional[str]:
    """예전 키로 암호화된 값이면 지금 키로 다시 암호화한 값을, 이미 지금 키면 None. 못 풀면 InvalidToken."""
    if not needs_rotation(token):
        return None
    return _cipher().rotate(token.encode("utf-8")).decode("utf-8")


def fingerprint() -> str:
    return hashlib.sha256(b"fp|" + primary_key()).hexdigest()[:16]


# --------------------------------------------------------------------------- 주민번호 (기존 함수 이름 유지)

def encrypt_ssn(plaintext: str) -> str:
    """주민번호 암호화. 빈 값은 빈 문자열."""
    if not plaintext:
        return ""
    return encrypt(plaintext)


def decrypt_ssn(ciphertext: str) -> str:
    if not ciphertext:
        return ""
    return decrypt(ciphertext)


def mask_ssn(ssn: str) -> str:
    """화면 표시용: '900101-1234567' -> '900101-1******'."""
    if not ssn or len(ssn) < 8:
        return ssn or ""
    return ssn[:8] + "******"


# --------------------------------------------------------------------------- 기동 점검

def is_production() -> bool:
    if (settings.APP_ENV or "").lower() in ("production", "prod"):
        return True
    return bool(os.environ.get("RAILWAY_ENVIRONMENT") or os.environ.get("RAILWAY_ENVIRONMENT_NAME"))


def startup_problems() -> tuple[list[str], list[str]]:
    """(서버를 멈출 문제, 경고)."""
    fatal, warn = [], []
    sk = settings.SECRET_KEY or ""
    weak = sk.strip().lower() in WEAK_SECRETS or len(sk) < MIN_SECRET_LEN
    if weak:
        (fatal if is_production() else warn).append(
            f"SECRET_KEY 가 기본값이거나 너무 짧습니다({len(sk)}자, {MIN_SECRET_LEN}자 이상 필요).")
    ek = settings.ENCRYPTION_KEY or ""
    if not ek:
        warn.append("ENCRYPTION_KEY 가 없습니다. 저장 데이터가 아직 SECRET_KEY 로 암호화됩니다(SECRET_KEY 를 바꾸면 못 읽음).")
    else:
        if len(ek) < MIN_SECRET_LEN or ek.strip().lower() in WEAK_SECRETS:
            (fatal if is_production() else warn).append(f"ENCRYPTION_KEY 가 너무 짧습니다({len(ek)}자, {MIN_SECRET_LEN}자 이상 필요).")
        if ek == sk:
            warn.append("ENCRYPTION_KEY 가 SECRET_KEY 와 같습니다. 서로 다른 값을 쓰세요.")
    return fatal, warn


def check_startup() -> None:
    """웹 서버가 뜰 때 부른다. 운영에서 키가 약하면 RuntimeError 로 기동을 멈춘다(fail-fast)."""
    fatal, warn = startup_problems()
    for w in warn:
        logger.warning("[보안 설정] %s", w)
    if fatal:
        raise RuntimeError("[보안 설정] 서버를 시작하지 않습니다: " + " / ".join(fatal))


# --------------------------------------------------------------------------- 저장된 값 다시 암호화

# (테이블 모델 경로, 컬럼들) — 암호화 값이 들어 있는 곳 전부
_TARGETS = [
    ("app.models.client", "Client", ["ssn_encrypted"]),
    ("app.models.user_api_key", "UserApiKey", ["api_key", "api_secret"]),
    ("app.models.ai_setting", "AIAPISetting", ["api_key_encrypted"]),
]


async def rotate_all(db, *, batch: int = 200) -> dict:
    """저장된 암호화 값을 모두 지금 키로 다시 암호화한다. 이미 지금 키인 값은 건드리지 않는다.
    못 푸는 값(이미 키를 잃은 것)은 그대로 두고 개수만 센다."""
    import importlib

    from sqlalchemy import select

    out = {"rotated": 0, "kept": 0, "unreadable": 0, "tables": {}}
    for mod, cls_name, cols in _TARGETS:
        try:
            model = getattr(importlib.import_module(mod), cls_name)
        except (ImportError, AttributeError):
            continue
        t = {"rotated": 0, "kept": 0, "unreadable": 0}
        last_id = ""
        while True:
            rows = (await db.execute(select(model).where(model.id > last_id).order_by(model.id).limit(batch))).scalars().all()
            if not rows:
                break
            for row in rows:
                for col in cols:
                    val = getattr(row, col, None)
                    if not val:
                        continue
                    try:
                        new = rotate(val)
                    except InvalidToken:
                        t["unreadable"] += 1
                        continue
                    if new is None:
                        t["kept"] += 1
                    else:
                        setattr(row, col, new)
                        t["rotated"] += 1
            last_id = rows[-1].id
            await db.commit()
        out["tables"][cls_name] = t
        for k in ("rotated", "kept", "unreadable"):
            out[k] += t[k]
    return out


async def rotate_if_needed(db) -> Optional[dict]:
    """ENCRYPTION_KEY 가 있고, 지난번 다시 암호화한 키와 다르면 rotate_all. 결과는 app_settings 에 남긴다."""
    import json

    from app.services import settings_store

    if not settings.ENCRYPTION_KEY:
        return None
    fp = fingerprint()
    if await settings_store.get(db, FP_KEY) == fp:
        return None
    res = await rotate_all(db)
    from app.services.company_report.timeutil import now_kst

    res["at"] = now_kst().isoformat(timespec="seconds")
    await settings_store.set_value(db, ROTATION_KEY, json.dumps(res, ensure_ascii=False))
    await settings_store.set_value(db, FP_KEY, fp)
    logger.warning("[보안 설정] 저장 데이터를 새 암호화 키로 다시 암호화했습니다: %s", res)
    return res
