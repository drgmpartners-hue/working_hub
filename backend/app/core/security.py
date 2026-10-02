"""Security utilities for authentication and encryption."""
from datetime import datetime, timedelta
from typing import Any
from jose import jwt
from passlib.context import CryptContext
from app.core.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 days
# 대행 토큰 유효기간 = 일반 로그인과 동일 (docs/login_logic 결정 D-4: 대행에 별도 시간제한을 두지 않는다.
# 지시서 7.1의 '2시간'은 대표님 결정으로 폐기 — 대표가 업무 도중 끊기지 않도록)
IMPERSONATION_TOKEN_EXPIRE_MINUTES = ACCESS_TOKEN_EXPIRE_MINUTES


def encrypt_api_key(plain_text: str) -> str:
    """API 키 암호화 — app.core.encryption 하나로 통일(수정_tasks P2-1)."""
    from app.core import encryption

    return encryption.encrypt(plain_text)


def decrypt_api_key(encrypted: str) -> str:
    from app.core import encryption

    return encryption.decrypt(encrypted)


def mask_api_key(plain_text: str) -> str:
    """Return a masked version of the plain-text API key.

    Example: 'sk-abcdefgh1234' -> 'sk-...1234'
    Keys shorter than 4 characters are returned as-is.
    """
    if len(plain_text) <= 4:
        return plain_text
    return f"sk-...{plain_text[-4:]}"


def create_access_token(
    subject: str | Any,
    expires_delta: timedelta | None = None,
    extra_claims: dict | None = None,
) -> str:
    """Create JWT access token.

    extra_claims: 대행 로그인 토큰의 act(실제 행위자)·imp(대행 표식) 등 추가 클레임.
    None 이면 기존과 동일한 {"exp", "sub"} 토큰.
    """
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)

    to_encode = {"exp": expire, "sub": str(subject)}
    if extra_claims:
        to_encode.update(extra_claims)
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a plain password against a hash."""
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    """Hash a password."""
    return pwd_context.hash(password)
