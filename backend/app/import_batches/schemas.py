from datetime import datetime
from typing import Literal
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


class ImportBatchRetrySummarySchema(BaseModel):
    batch_id: UUID
    restarted: int


class ImportBatchReviewAssetItemSchema(BaseModel):
    asset_id: UUID
    title: str | None
    status: str
    preview_status: str
    faces_status: str
    review_faces_count: int
    preview_file_id: UUID | None
    preview_url: str | None
    created_at: datetime


class ImportBatchReviewAssetsResponseSchema(BaseModel):
    items: list[ImportBatchReviewAssetItemSchema]
    total: int
    limit: int
    offset: int


class ImportBatchDuplicateCandidateItemSchema(BaseModel):
    id: UUID
    candidate_asset_id: UUID
    candidate_title: str | None
    candidate_preview_url: str | None
    duplicate_type: str
    score: float | None
    distance: int | None
    rank: int
    review_decision: str | None


class ImportBatchDuplicateGroupSchema(BaseModel):
    source_asset_id: UUID
    source_title: str | None
    source_preview_url: str | None
    duplicate_review_status: str
    candidates: list[ImportBatchDuplicateCandidateItemSchema]


class ImportBatchDuplicatesResponseSchema(BaseModel):
    groups: list[ImportBatchDuplicateGroupSchema]


class DuplicateCandidateReviewRequest(BaseModel):
    decision: Literal["confirmed_duplicate", "rejected", "kept_both"]


class ImportBatchTagsApplyRequest(BaseModel):
    tags: list[str] = Field(default_factory=list, max_length=30)
    mode: Literal["merge"] = "merge"


class ImportBatchTagsApplyResponse(BaseModel):
    batch_id: UUID
    updated_assets: int
    tags: list[str]


class ImportBatchTagSuggestionItemSchema(BaseModel):
    tag: str
    count: int


class ImportBatchTagSuggestionsResponseSchema(BaseModel):
    recent: list[ImportBatchTagSuggestionItemSchema]
    popular: list[ImportBatchTagSuggestionItemSchema]
    similar_batches: list[ImportBatchTagSuggestionItemSchema]
