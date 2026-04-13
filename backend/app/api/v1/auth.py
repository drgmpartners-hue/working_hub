"""Authentication endpoints."""
import logging
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import get_db
from app.schemas.auth import Token, LoginRequest, RegisterRequest, PasswordChangeRequest
from app.schemas.user import UserResponse
from app.services.auth import authenticate_user, create_user, get_user_by_email, update_password
from app.core.security import create_access_token, verify_password, get_password_hash
from app.core.deps import CurrentUser
from app.core.config import settings
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def register(
    user_in: RegisterRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Register a new user."""
    existing_user = await get_user_by_email(db, user_in.email)
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )

    user = await create_user(db, user_in)
    return user


@router.post("/login", response_model=Token)
async def login(
    db: Annotated[AsyncSession, Depends(get_db)],
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
):
    """Login and get access token."""
    user = await authenticate_user(db, form_data.username, form_data.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    access_token = create_access_token(subject=user.id)
    return Token(access_token=access_token)


@router.post("/login/json", response_model=Token)
async def login_json(
    login_data: LoginRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Login with JSON body and get access token."""
    user = await authenticate_user(db, login_data.email, login_data.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        )

    access_token = create_access_token(subject=user.id)
    return Token(access_token=access_token)


@router.post("/logout")
async def logout(current_user: CurrentUser):
    """Logout current user.

    Note: For stateless JWT, this endpoint just returns success.
    Implement token blacklist for true logout functionality.
    """
    return {"message": "Successfully logged out"}


@router.post("/password/change")
async def change_password(
    password_data: PasswordChangeRequest,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Change current user's password."""
    if not verify_password(password_data.current_password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Incorrect current password"
        )

    await update_password(db, current_user, password_data.new_password)
    return {"message": "Password changed successfully"}


from pydantic import BaseModel

class GoogleLoginRequest(BaseModel):
    credential: str  # Google ID token


@router.post("/google", response_model=Token)
async def google_login(
    data: GoogleLoginRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Login with Google OAuth. Auto-registers if email not found."""
    import httpx

    # Verify Google ID token
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"https://oauth2.googleapis.com/tokeninfo?id_token={data.credential}"
            )
    except Exception as e:
        logger.error(f"Google token verification failed: {e}")
        raise HTTPException(status_code=500, detail=f"Google verification error: {str(e)}")

    if resp.status_code != 200:
        logger.error(f"Google token invalid: {resp.status_code} {resp.text}")
        raise HTTPException(status_code=401, detail="Invalid Google token")

    google_info = resp.json()

    # Verify audience matches our client ID
    if google_info.get("aud") != settings.GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=401, detail="Token audience mismatch")

    email = google_info.get("email")
    if not email:
        raise HTTPException(status_code=400, detail="Email not found in Google token")

    # Check if user exists
    user = await get_user_by_email(db, email)

    if not user:
        # Auto-register with Google info
        import uuid
        user = User(
            email=email,
            hashed_password=get_password_hash(uuid.uuid4().hex),  # random password
            nickname=google_info.get("name", email.split("@")[0]),
            profile_image=google_info.get("picture"),
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
        logger.info(f"Auto-registered Google user: {email}")

    access_token = create_access_token(subject=user.id)
    return Token(access_token=access_token)
