from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class ExportCreateRequest(BaseModel):
    asset_ids: list[uuid.UUID] = Field(min_length=1, max_length=200)


class ExportJobSchema(BaseModel):
    id: uuid.UUID
    status: str
    total: int
    processed: int
    error: str | None = None
    download_ready: bool
    created_at: datetime
    expires_at: datetime | None = None

    class Config:
        from_attributes = True
