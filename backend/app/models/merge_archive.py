"""중복 고객 합치기 때 정리한 자료의 보관본 (2026-10-08).

양쪽 모두 은퇴설계가 있으면 최근 것을 남기고 다른 쪽은 지우는데, 지우기 전에 그 프로필과 딸린 플랜·투자기록을
그대로(JSON) 여기 남긴다. 화면에는 쓰지 않고, 필요하면 되살리는 근거로만 쓴다.

합치기 기능 자체는 정리가 끝나 2026-10-08 에 없앴다. 이 표에는 그때 보관한 자료가 남아 있으므로 모델·표는 그대로 둔다.
"""
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import JSON, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.base import Base


class MergeArchive(Base):
    __tablename__ = "merge_archives"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    kind: Mapped[str] = mapped_column(String(40), nullable=False)          # 'retirement_profile'
    client_id: Mapped[Optional[str]] = mapped_column(String(36), index=True)  # 합친 뒤 남은 고객
    removed_client_id: Mapped[Optional[str]] = mapped_column(String(36))
    payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_by: Mapped[Optional[str]] = mapped_column(String(36))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
