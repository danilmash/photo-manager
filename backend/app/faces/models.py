from sqlalchemy import (
    Boolean, Column, Float, ForeignKey, String, UUID, TIMESTAMP, func
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from app.database import Base
import uuid
from pgvector.sqlalchemy import Vector

class Person(Base):
    __tablename__ = "persons"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(256), nullable=False)
    cover_face_id = Column(UUID(as_uuid=True), ForeignKey("face_detections.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(TIMESTAMP, server_default=func.now(), nullable=False)
    updated_at = Column(TIMESTAMP, server_default=func.now(), onupdate=func.now(), nullable=False)

    detections = relationship("FaceDetection", back_populates="person",
                              foreign_keys="FaceDetection.person_id")

    cover_face = relationship("FaceDetection",
                              foreign_keys=[cover_face_id],
                              post_update=True)

class FaceDetection(Base):
    __tablename__ = "face_detections"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    asset_id     = Column(UUID(as_uuid=True), ForeignKey("assets.id", ondelete="CASCADE"), nullable=False)
    person_id    = Column(UUID(as_uuid=True), ForeignKey("persons.id", ondelete="SET NULL"), nullable=True)
    bbox         = Column(JSONB, nullable=False) # [x, y, width, height]
    embedding    = Column(Vector(128), nullable=False)
    confidence   = Column(Float, nullable=False)        # уверенность детектора
    created_at   = Column(TIMESTAMP, server_default=func.now(), nullable=False)

    person = relationship("Person", back_populates="detections",
                          foreign_keys=[person_id])