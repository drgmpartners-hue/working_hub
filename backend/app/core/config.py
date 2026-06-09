from pydantic_settings import BaseSettings
from pydantic import computed_field

class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/app"
    SECRET_KEY: str = "changeme"
    GEMINI_API_KEY: str = ""

    # Email (SMTP) settings — optional; leave empty to use mock logging
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    STAFF_EMAIL: str = ""         # recipient for staff notifications
    FRONTEND_URL: str = "http://localhost:3000"  # used to build portal links

    # Naver API settings
    NAVER_CLIENT_ID: str = ""
    NAVER_CLIENT_SECRET: str = ""

    # Solapi SMS settings
    SOLAPI_API_KEY: str = ""
    SOLAPI_API_SECRET: str = ""
    SOLAPI_SENDER: str = ""  # 발신번호 (등록 후 입력)
    SOLAPI_PF_ID: str = ""   # 카카오 비즈니스 채널 ID (예: @channelname)

    # Google OAuth
    GOOGLE_CLIENT_ID: str = ""

    # Resend (이메일 발송 — API 키 하나로 발송, SMTP 불필요)
    RESEND_API_KEY: str = ""
    RESEND_FROM: str = "onboarding@resend.dev"  # 도메인 인증 전 기본 발신주소(가입 본인 메일로만 발송)

    @computed_field
    @property
    def ASYNC_DATABASE_URL(self) -> str:
        """Return asyncpg-compatible URL for SQLAlchemy async engine."""
        url = self.DATABASE_URL
        if url.startswith("postgresql+asyncpg://"):
            return url
        if url.startswith("postgresql://"):
            return url.replace("postgresql://", "postgresql+asyncpg://", 1)
        if url.startswith("postgres://"):
            return url.replace("postgres://", "postgresql+asyncpg://", 1)
        return url

    class Config:
        env_file = ".env"

settings = Settings()
