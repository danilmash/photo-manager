from uuid import UUID
from pydantic import BaseModel
from datetime import datetime


class PersonSchema(BaseModel):
    id: UUID
    name: str
    cover_face_id: UUID | None
    created_at: datetime
    updated_at: datetime

class FaceDetectionSchema(BaseModel):
    id: UUID
    asset_id: UUID
    person_id: UUID | None
    bbox: dict
    embedding: list[float]
    confidence: float
    created_at: datetime    
    person: PersonSchema | None