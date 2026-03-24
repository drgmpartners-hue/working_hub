"""AES encryption utility for sensitive data (SSN)."""
import base64
from cryptography.fernet import Fernet
from app.core.config import settings


def _get_fernet() -> Fernet:
    # Use first 32 chars of SECRET_KEY as the symmetric key
    key_bytes = settings.SECRET_KEY[:32].ljust(32, "0").encode()
    return Fernet(base64.urlsafe_b64encode(key_bytes))


def encrypt_ssn(plaintext: str) -> str:
    """Encrypt a plaintext SSN string. Returns empty string for empty input."""
    if not plaintext:
        return ""
    return _get_fernet().encrypt(plaintext.encode()).decode()


def decrypt_ssn(ciphertext: str) -> str:
    """Decrypt a previously encrypted SSN string. Returns empty string for empty input."""
    if not ciphertext:
        return ""
    return _get_fernet().decrypt(ciphertext.encode()).decode()


def mask_ssn(ssn: str) -> str:
    """Mask SSN for display: '900101-1234567' -> '900101-1******'."""
    if not ssn or len(ssn) < 8:
        return ssn or ""
    return ssn[:8] + "******"
