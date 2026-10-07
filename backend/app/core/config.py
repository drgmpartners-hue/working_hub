from pydantic_settings import BaseSettings
from pydantic import computed_field

class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/app"
    SECRET_KEY: str = "changeme"          # 로그인(JWT)·링크 서명 전용
    # SECRET_KEY 를 바꿀 때 예전 값(쉼표 구분). 이미 보낸 브리핑·보고서 링크(문자·알림톡)만 이 값으로도 확인한다.
    # 로그인은 예전 값으로 받지 않는다(바꾸면 모두 한 번 다시 로그인). 링크 유효기간(최대 180일)이 지나면 비워도 됨.
    OLD_SECRET_KEYS: str = ""
    # 저장 데이터(주민번호·API 키) 암호화 전용 키 (수정_tasks P2-1). 비어 있으면 예전처럼 SECRET_KEY 로 암호화.
    # 한 번 정하면 바꾸지 말 것 — 바꿀 때는 이전 값을 OLD_ENCRYPTION_KEYS 에 넣어 두면 기동 때 새 키로 다시 암호화한다.
    ENCRYPTION_KEY: str = ""
    OLD_ENCRYPTION_KEYS: str = ""          # 쉼표로 구분한 이전 암호화 키(읽기 전용)
    APP_ENV: str = ""                      # production 이면 약한 키로 기동 금지(Railway 는 자동으로 운영 판단)
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

    def link_secrets(self) -> list[str]:
        """링크 서명 확인에 쓸 키들: 지금 SECRET_KEY 먼저, 그다음 예전 값들."""
        return [self.SECRET_KEY] + [k.strip() for k in (self.OLD_SECRET_KEYS or "").split(",") if k.strip()]

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
