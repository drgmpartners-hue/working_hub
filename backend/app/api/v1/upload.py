"""File upload endpoints."""
from __future__ import annotations

import os
import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.db.session import get_db
from app.models.file_upload import FileUpload
from app.schemas.file_upload import FileUploadResponse
from app.services.excel_service import parse_excel_bytes

router = APIRouter(prefix="/upload", tags=["upload"])

# Directory where uploaded files are stored (relative to the process cwd).
# In production, override with an absolute path via configuration.
UPLOAD_DIR = "uploads"

ALLOWED_EXTENSIONS = {".xlsx", ".xls"}
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB


def _ensure_upload_dir() -> str:
    """Create the uploads directory if it does not exist and return its path."""
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    return UPLOAD_DIR


@router.post(
    "/excel",
    response_model=FileUploadResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Upload and parse an Excel file",
)
async def upload_excel(
    file: UploadFile,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> FileUploadResponse:
    """Accept an Excel (.xlsx / .xls) file, parse it with openpyxl, persist
    the record to the database and return the created ``FileUpload`` record.

    Requires a valid Bearer token.
    """
    # ------------------------------------------------------------------
    # 1. Validate file extension
    # ------------------------------------------------------------------
    original_name: str = file.filename or "upload"
    _, ext = os.path.splitext(original_name.lower())
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file type '{ext}'. Allowed: {sorted(ALLOWED_EXTENSIONS)}",
        )

    # ------------------------------------------------------------------
    # 2. Read file content
    # ------------------------------------------------------------------
    content: bytes = await file.read()
    file_size: int = len(content)

    if file_size == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is empty.",
        )

    if file_size > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File exceeds the maximum allowed size of {MAX_FILE_SIZE // (1024 * 1024)} MB.",
        )

    # ------------------------------------------------------------------
    # 3. Persist to filesystem
    # ------------------------------------------------------------------
    upload_dir = _ensure_upload_dir()
    unique_name = f"{uuid.uuid4().hex}{ext}"
    file_path = os.path.join(upload_dir, unique_name)

    try:
        with open(file_path, "wb") as f:
            f.write(content)
    except OSError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Could not save file: {exc}",
        ) from exc

    # ------------------------------------------------------------------
    # 4. Parse Excel
    # ------------------------------------------------------------------
    try:
        parsed_data = parse_excel_bytes(content)
    except ValueError as exc:
        # Remove the saved file if parsing fails to avoid orphaned files
        try:
            os.remove(file_path)
        except OSError:
            pass
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    # ------------------------------------------------------------------
    # 5. Persist record to database
    # ------------------------------------------------------------------
    record = FileUpload(
        file_name=original_name,
        file_path=file_path,
        file_size=file_size,
        parsed_data=parsed_data,
        uploaded_at=datetime.utcnow(),
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)

    return FileUploadResponse.model_validate(record)
