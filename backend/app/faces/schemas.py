from uuid import UUID
from pydantic import BaseModel
from datetime import datetime


class PersonSchema(BaseModel):
    id: UUID
    name: str
    cover_face_id: UUID | None
    created_at: datetime
    updated_at: datetime


class PersonListItemSchema(BaseModel):
    id: UUID
    name: str
    photos_count: int
    cover_url: str | None


class FaceIdentitySchema(BaseModel):
    id: UUID
    person_id: UUID | None
    cover_face_id: UUID | None
    samples_count: int
    created_at: datetime
    updated_at: datetime

    person: PersonSchema | None = None


class FaceCandidateSchema(BaseModel):
    id: UUID
    face_detection_id: UUID
    identity_id: UUID
    rank: int
    score: float

    identity: FaceIdentitySchema | None = None


class AssignIdentityRequest(BaseModel):
    identity_id: UUID


class AssignPersonRequest(BaseModel):
    person_id: UUID


class AssignNewPersonRequest(BaseModel):
    name: str | None = ""


class AssignIdentityPersonRequest(BaseModel):
    person_id: UUID


class AssignIdentityNewPersonRequest(BaseModel):
    name: str | None = ""


class FaceAssignmentResponse(BaseModel):
    detection_id: UUID
    identity_id: UUID | None
    identity_score: float | None
    assignment_source: str | None
    is_reference: bool


class FaceDetectionSchema(BaseModel):
    id: UUID
    asset_id: UUID
    asset_version_id: UUID
    identity_id: UUID | None
    face_index: int
    bbox: dict
    embedding: list[float]
    confidence: float
    quality_score: float | None
    identity_score: float | None
    is_reference: bool
    model_identity_id: UUID | None = None
    model_identity_score: float | None = None
    model_identity_margin: float | None = None
    assignment_source: str | None = None
    created_at: datetime

    identity: FaceIdentitySchema | None = None
    candidates: list[FaceCandidateSchema] = []


class ImportBatchFaceClusterDetectionSchema(BaseModel):
    id: UUID
    asset_id: UUID
    asset_title: str | None = None
    crop_url: str | None = None
    confidence: float | None = None
    quality_score: float | None = None
    review_required: bool
    review_state: str | None = None


class ImportBatchFaceClusterSchema(BaseModel):
    identity_id: UUID
    person_id: UUID | None = None
    person_name: str | None = None
    cover_url: str | None = None
    samples_count: int
    detections_count: int
    review_required_count: int
    detections: list[ImportBatchFaceClusterDetectionSchema]


class IdentityAssignmentResponse(BaseModel):
    identity_id: UUID
    person_id: UUID | None
    person_name: str | None = None
    review_required_count: int
