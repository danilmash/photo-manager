from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class RecipeCropSchema(BaseModel):
    x: float = Field(default=0.0, ge=0.0, le=1.0)
    y: float = Field(default=0.0, ge=0.0, le=1.0)
    w: float = Field(default=1.0, ge=0.0, le=1.0)
    h: float = Field(default=1.0, ge=0.0, le=1.0)

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def validate_bounds(self) -> "RecipeCropSchema":
        if self.x + self.w > 1.0:
            raise ValueError("crop.x + crop.w must be <= 1")
        if self.y + self.h > 1.0:
            raise ValueError("crop.y + crop.h must be <= 1")
        return self


class PhotoRecipeSchema(BaseModel):
    crop: RecipeCropSchema = Field(default_factory=RecipeCropSchema)
    rotation_degrees: float = Field(default=0.0, ge=-180.0, le=180.0)
    flip_horizontal: bool = False
    flip_vertical: bool = False
    exposure: float = Field(default=0.0, ge=-100.0, le=100.0)
    contrast: float = Field(default=0.0, ge=-100.0, le=100.0)
    highlights: float = Field(default=0.0, ge=-100.0, le=100.0)
    shadows: float = Field(default=0.0, ge=-100.0, le=100.0)
    temperature: float = Field(default=0.0, ge=-100.0, le=100.0)
    tint: float = Field(default=0.0, ge=-100.0, le=100.0)
    saturation: float = Field(default=0.0, ge=-100.0, le=100.0)
    sharpness: float = Field(default=0.0, ge=0.0, le=100.0)
    vignette: float = Field(default=0.0, ge=0.0, le=100.0)

    model_config = ConfigDict(extra="forbid")


class AssetVersionCreateRequest(BaseModel):
    recipe: PhotoRecipeSchema
    base_version_id: UUID | None = None

    model_config = ConfigDict(extra="forbid")


class AssetVersionStatusSchema(BaseModel):
    asset_id: UUID
    version_id: UUID
    version_number: int
    status: str
    preview_status: str
    faces_status: str
    preview_error: str | None = None
    faces_error: str | None = None


class AssetVersionJobResponseSchema(AssetVersionStatusSchema):
    job_id: str


class UploadResponseSchema(AssetVersionJobResponseSchema):
    filename: str


class AssetVersionSummarySchema(BaseModel):
    id: UUID
    version_number: int
    base_version_id: UUID | None = None
    status: str
    preview_status: str
    faces_status: str
    preview_error: str | None = None
    faces_error: str | None = None
    recipe: dict[str, Any]
    rendered_width: int | None = None
    rendered_height: int | None = None
    is_identity_source: bool
    preview_file_id: UUID | None = None
    preview_url: str | None = None
    thumbnail_file_id: UUID | None = None
    thumbnail_url: str | None = None
    created_at: datetime


class AssetListItemSchema(BaseModel):
    asset_id: UUID
    title: str | None
    created_at: datetime
    updated_at: datetime
    version: AssetVersionSummarySchema | None


class AssetListResponseSchema(BaseModel):
    items: list[AssetListItemSchema]
    next_cursor: str | None


class AssetVersionHistoryResponseSchema(BaseModel):
    items: list[AssetVersionSummarySchema]


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
    keywords: list[str] = Field(default_factory=list)


class AssetViewerFacePersonCandidateSchema(BaseModel):
    person_id: UUID
    person_name: str | None = None
    best_identity_id: UUID
    rank: int
    score: float


class AssetViewerFaceSchema(BaseModel):
    id: UUID
    asset_version_id: UUID
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
    candidates: list[AssetViewerFacePersonCandidateSchema] = Field(default_factory=list)


class AssetViewerResponseSchema(BaseModel):
    id: UUID
    title: str | None
    created_at: datetime
    updated_at: datetime | None = None
    version: AssetVersionSummarySchema | None
    photo: AssetPhotoInfoSchema
    faces: list[AssetViewerFaceSchema]
    faces_count: int


class AssetMetadataSchema(BaseModel):
    version_id: UUID | None = None
    version_number: int | None = None
    base_version_id: UUID | None = None
    status: str | None = None
    preview_status: str | None = None
    faces_status: str | None = None
    preview_error: str | None = None
    faces_error: str | None = None
    recipe: dict[str, Any] | None = None
    exif: dict[str, Any] | None = None
    iptc: dict[str, Any] | None = None
    xmp: dict[str, Any] | None = None
    other: dict[str, Any] | None = None
    rating: int | None = None
    keywords: list[str] = Field(default_factory=list)
    rendered_width: int | None = None
    rendered_height: int | None = None
    is_identity_source: bool | None = None
    created_at: datetime | None = None


class AssetMetadataResponseSchema(BaseModel):
    id: UUID
    title: str | None
    created_at: datetime
    updated_at: datetime | None = None
    metadata: AssetMetadataSchema | None = None
