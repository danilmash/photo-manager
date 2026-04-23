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
    preview_status: str
    faces_status: str
    preview_error: str | None = None
    faces_error: str | None = None


class AssetListItemSchema(BaseModel):
    asset_id: UUID
    title: str | None
    status: str
    preview_status: str
    faces_status: str
    created_at: datetime
    thumbnail_file_id: UUID | None
    thumbnail_url: str | None
    preview_file_id: UUID | None
    preview_url: str | None


class AssetListResponseSchema(BaseModel):
    items: list[AssetListItemSchema]
    next_cursor: str | None

from datetime import datetime
from uuid import UUID
from typing import Any

from pydantic import BaseModel


class AssetPhotoInfoSchema(BaseModel):
    filename: str | None = None
    mime_type: str | None = None
    size_bytes: int | None = None
    width: Any | None = None
    height: Any | None = None
    taken_at: Any | None = None
    camera_make: Any | None = None
    camera_model: Any | None = None
    lens: Any | None = None
    iso: Any | None = None
    aperture: Any | None = None
    shutter_speed: Any | None = None
    focal_length: Any | None = None
    rating: int | None = None
    keywords: list[str] = []


class AssetViewerFaceSchema(BaseModel):
    id: UUID
    identity_id: UUID | None = None
    person_id: UUID | None = None
    person_name: str | None = None
    bbox: Any | None = None
    confidence: float | None = None
    quality_score: float | None = None
    is_reference: bool = False
    assignment_source: str | None = None
    review_required: bool = True
    review_state: str | None = None
    candidates: list["AssetViewerFacePersonCandidateSchema"] = []


class AssetViewerFacePersonCandidateSchema(BaseModel):
    person_id: UUID
    person_name: str | None = None
    best_identity_id: UUID
    rank: int
    score: float


class AssetViewerResponseSchema(BaseModel):
    id: UUID
    title: str
    status: str
    preview_status: str
    faces_status: str
    preview_error: str | None = None
    faces_error: str | None = None
    created_at: datetime
    updated_at: datetime | None = None
    preview_file_id: UUID | None = None
    preview_url: str | None = None
    photo: AssetPhotoInfoSchema
    faces: list[AssetViewerFaceSchema]
    faces_count: int


class AssetMetadataSchema(BaseModel):
    version_id: UUID | None = None
    version_number: int | None = None
    exif: dict[str, Any] | None = None
    iptc: dict[str, Any] | None = None
    xmp: dict[str, Any] | None = None
    other: dict[str, Any] | None = None
    rating: int | None = None
    keywords: list[str] = []
    created_at: datetime | None = None


class AssetMetadataResponseSchema(BaseModel):
    id: UUID
    title: str
    status: str
    created_at: datetime
    updated_at: datetime | None = None
    metadata: AssetMetadataSchema | None = None