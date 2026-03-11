"""Security utilities for authentication and encryption."""
import base64
import hashlib
from datetime import datetime, timedelta
from typing import Any
from cryptography.fernet import Fernet
from jose import jwt
from passlib.context import CryptContext
from app.core.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 days


def _get_fernet() -> Fernet:
    """Derive a Fernet instance from SECRET_KEY.

    Fernet requires a 32-byte URL-safe base64-encoded key. We derive one
    deterministically from SECRET_KEY using SHA-256 so that no extra
    environment variable is needed.
    """
    raw = settings.SECRET_KEY.encode("utf-8")
    key_bytes = hashlib.sha256(raw).digest()  # always 32 bytes
    fernet_key = base64.urlsafe_b64encode(key_bytes)
    return Fernet(fernet_key)


def encrypt_api_key(plain_text: str) -> str:
    """Encrypt an API key and return a URL-safe base64 string."""
    fernet = _get_fernet()
    return fernet.encrypt(plain_text.encode("utf-8")).decode("utf-8")


def decrypt_api_key(encrypted: str) -> str:
    """Decrypt an API key encrypted with :func:`encrypt_api_key`."""
    fernet = _get_fernet()
    return fernet.decrypt(encrypted.encode("utf-8")).decode("utf-8")


def mask_api_key(plain_text: str) -> str:
    """Return a masked version of the plain-text API key.

    Example: 'sk-abcdefgh1234' -> 'sk-...1234'
    Keys shorter than 4 characters are returned as-is.
    """
    if len(plain_text) <= 4:
        return plain_text
    return f"sk-...{plain_text[-4:]}"


def create_access_token(subject: str | Any, expires_delta: timedelta | None = None) -> str:
    """Create JWT access token."""
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)

    to_encode = {"exp": expire, "sub": str(subject)}
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a plain password against a hash."""
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    """Hash a password."""
    return pwd_context.hash(password)
