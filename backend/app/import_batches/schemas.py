from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class ImportBatchCreateRequest(BaseModel):
    # Партия всегда создаётся без проекта (в основной библиотеке).
    # Привязать к проекту можно отдельным эндпоинтом.
    note: str | None = Field(default=None, max_length=2000)


class ImportBatchSetProjectRequest(BaseModel):
    # null => отвязать партию от проекта (вернуть в основную библиотеку).
    project_id: UUID | None = None


class ImportBatchSchema(BaseModel):
    id: UUID
    project_id: UUID | None
    status: str
    note: str | None
    assets_count: int
    created_at: datetime
    updated_at: datetime
