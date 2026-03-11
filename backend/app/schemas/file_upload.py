"""File upload schemas."""
from datetime import datetime
from typing import Any, Optional
from pydantic import BaseModel


class FileUploadResponse(BaseModel):
    """Response schema for a file upload record."""

    id: str
    file_name: str
    file_path: str
    file_size: int
    parsed_data: Optional[Any] = None
    uploaded_at: datetime

    class Config:
        from_attributes = True
