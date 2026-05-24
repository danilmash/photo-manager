from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class FolderCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=256)

    model_config = ConfigDict(extra="forbid")


class FolderUpdateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=256)

    model_config = ConfigDict(extra="forbid")


class FolderSummarySchema(BaseModel):
    id: UUID
    name: str
    asset_count: int
    created_at: datetime
    updated_at: datetime


class FolderListResponseSchema(BaseModel):
    items: list[FolderSummarySchema]


class AssetFoldersUpdateRequest(BaseModel):
    folder_ids: list[UUID] = Field(default_factory=list, max_length=100)

    model_config = ConfigDict(extra="forbid")


class AssetFoldersResponseSchema(BaseModel):
    asset_id: UUID
    folders: list[FolderSummarySchema]
