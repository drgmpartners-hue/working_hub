from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from app.core.config import settings

# pool_pre_ping: Railway 등이 끊은 유휴 커넥션을 재사용해 간헐 500 나는 문제 방지
# pool_recycle: 5분 지난 커넥션은 재생성
# echo=False: SQL·바인드 파라미터(암호화 키/주민번호 포함) 로그 유출 차단
engine = create_async_engine(
    settings.ASYNC_DATABASE_URL,
    echo=False,
    pool_pre_ping=True,
    pool_recycle=300,
)
AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
