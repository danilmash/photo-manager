from pydantic import BaseModel
from datetime import datetime
from uuid import UUID

from app.faces.schemas import FaceDetectionSchema


class FileSchema(BaseModel):
    id: UUID
    filename: str
    mime_type: str
    width: int | None
    height: int | None
    size_bytes: int
    path: str
    purpose: str

    class Config:
        from_attributes = True


class AssetVersionSchema(BaseModel):
    id: UUID
    version_number: int
    recipe: dict
    exif: dict | None
    iptc: dict | None
    xmp: dict | None
    other: dict | None
    rating: int | None
    keywords: list[str]
    created_at: datetime

    class Config:
        from_attributes = True


class AssetSchema(BaseModel):
    id: UUID
    title: str | None
    status: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class AssetVersionDetailSchema(BaseModel):
    id: UUID
    version_number: int
    face_detections: list[FaceDetectionSchema] | None
    exif: dict | None
    iptc: dict | None
    xmp: dict | None
    other: dict | None
    rating: int | None
    keywords: list[str]
    created_at: datetime


class AssetDetailResponse(BaseModel):
    id: UUID
    title: str | None
    status: str
    created_at: datetime
    updated_at: datetime
    preview_file_id: UUID | None
    preview_url: str | None
    version: AssetVersionDetailSchema | None


class AssetDetailSchema(AssetSchema):
    file: FileSchema | None
    version: AssetVersionSchema | None


class UploadResponseSchema(BaseModel):
    asset_id: UUID
    job_id: str
    filename: str
    status: str


class AssetStatusSchema(BaseModel):
    asset_id: UUID
    status: str


class AssetListItemSchema(BaseModel):
    asset_id: UUID
    title: str | None
    status: str
    created_at: datetime
    thumbnail_file_id: UUID | None
    thumbnail_url: str | None


class AssetListResponseSchema(BaseModel):
    items: list[AssetListItemSchema]
    next_cursor: str | None