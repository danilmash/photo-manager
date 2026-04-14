from sqlalchemy import (
    Boolean, Column, Float, ForeignKey, Integer, String, UUID, TIMESTAMP, func
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

    identities = relationship(
        "FaceIdentity",
        back_populates="person",
        foreign_keys="FaceIdentity.person_id",
    )

    cover_face = relationship(
        "FaceDetection",
        foreign_keys=[cover_face_id],
        post_update=True,
    )

class FaceIdentity(Base):
    __tablename__ = "face_identities"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # Может быть NULL, если это пока неизвестный человек
    person_id = Column(
        UUID(as_uuid=True),
        ForeignKey("persons.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Лицо для превью identity в UI / внутренних инструментах
    cover_face_id = Column(
        UUID(as_uuid=True),
        ForeignKey("face_detections.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Центр кластера подтвержденных / подходящих face embeddings
    centroid_embedding = Column(Vector(128), nullable=True)

    # Сколько faces входит в identity
    samples_count = Column(Integer, nullable=False, default=0)

    created_at = Column(TIMESTAMP, server_default=func.now(), nullable=False)
    updated_at = Column(
        TIMESTAMP,
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    person = relationship(
        "Person",
        back_populates="identities",
        foreign_keys=[person_id],
    )

    detections = relationship(
        "FaceDetection",
        back_populates="identity",
        foreign_keys="FaceDetection.identity_id",
    )

    cover_face = relationship(
        "FaceDetection",
        foreign_keys=[cover_face_id],
        post_update=True,
    )

class FaceDetection(Base):
    __tablename__ = "face_detections"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    asset_id     = Column(UUID(as_uuid=True), ForeignKey("assets.id", ondelete="CASCADE"), nullable=False)

    identity_id = Column(
        UUID(as_uuid=True),
        ForeignKey("face_identities.id", ondelete="SET NULL"),
        nullable=True,
    )

    face_index   = Column(Integer, nullable=False)
    bbox         = Column(JSONB, nullable=False) # [x, y, width, height]
    embedding    = Column(Vector(128), nullable=False)
    confidence   = Column(Float, nullable=False)

    quality_score = Column(Float, nullable=True)
    identity_score = Column(Float, nullable=True)
    
    is_reference = Column(Boolean, nullable=False, default=False)

    created_at   = Column(TIMESTAMP, server_default=func.now(), nullable=False)

    identity = relationship(
        "FaceIdentity",
        back_populates="detections",
        foreign_keys=[identity_id],
    )