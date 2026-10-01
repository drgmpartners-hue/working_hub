"""User schemas."""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, EmailStr


class UserBase(BaseModel):
    email: EmailStr
    nickname: str
    profile_image: Optional[str] = None


class UserCreate(UserBase):
    password: str


class UserUpdate(BaseModel):
    nickname: Optional[str] = None
    phone: Optional[str] = None
    profile_image: Optional[str] = None


class UserResponse(UserBase):
    id: str
    phone: Optional[str] = None
    is_active: bool
    role: str = "manager"  # "owner" | "manager" (is_superuser 는 계속 비노출)
    programs: list[str] = []  # 사용 가능 프로그램 (docs/login_logic P11)
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class UserInDB(UserResponse):
    hashed_password: str
