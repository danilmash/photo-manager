from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP, UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from pgvector.sqlalchemy import Vector

from app.database import Base
import uuid


VERSION_STATUS_UPLOADED = "uploaded"
VERSION_STATUS_PROCESSING = "processing"
VERSION_STATUS_READY = "ready"
VERSION_STATUS_PARTIAL_ERROR = "partial_error"
VERSION_STATUS_ERROR = "error"

ASSET_LIFECYCLE_ACTIVE = "active"
ASSET_LIFECYCLE_TRASHED = "trashed"

DUPLICATE_REVIEW_PENDING = "pending"
DUPLICATE_REVIEW_NO_DUPLICATES = "no_duplicates"
DUPLICATE_REVIEW_HAS_DUPLICATES = "has_duplicates"
DUPLICATE_REVIEW_REVIEWED = "reviewed"

DUPLICATE_TYPE_EXACT = "exact"
DUPLICATE_TYPE_VISUAL = "visual"
DUPLICATE_TYPE_NEAR = "near"

DUPLICATE_DECISION_CONFIRMED = "confirmed_duplicate"
DUPLICATE_DECISION_REJECTED = "rejected"
DUPLICATE_DECISION_KEPT_BOTH = "kept_both"

TASK_STATUS_PENDING = "pending"
TASK_STATUS_PROCESSING = "processing"
TASK_STATUS_COMPLETED = "completed"
TASK_STATUS_FAILED = "failed"


def derive_version_status(preview_status: str, faces_status: str) -> str:
    if preview_status == TASK_STATUS_FAILED:
        return VERSION_STATUS_ERROR
    if preview_status == TASK_STATUS_PROCESSING or faces_status == TASK_STATUS_PROCESSING:
        return VERSION_STATUS_PROCESSING
    if preview_status == TASK_STATUS_COMPLETED and faces_status == TASK_STATUS_COMPLETED:
        return VERSION_STATUS_READY
    if preview_status == TASK_STATUS_COMPLETED and faces_status == TASK_STATUS_FAILED:
        return VERSION_STATUS_PARTIAL_ERROR
    return VERSION_STATUS_UPLOADED


class File(Base):
    __tablename__ = "files"
    __table_args__ = (
        UniqueConstraint(
            "asset_version_id",
            "purpose",
            name="uq_file_asset_version_purpose",
        ),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    asset_id = Column(
        UUID(as_uuid=True),
        ForeignKey("assets.id", ondelete="CASCADE"),
        nullable=False,
    )
    asset_version_id = Column(
        UUID(as_uuid=True),
        ForeignKey("asset_versions.id", ondelete="CASCADE"),
        nullable=True,
    )
    filename = Column(String(512), nullable=False)
    mime_type = Column(String(128), nullable=False)
    width = Column(Integer, nullable=True)
    height = Column(Integer, nullable=True)
    size_bytes = Column(BigInteger, nullable=False)
    path = Column(Text, nullable=False)
    purpose = Column(String(32), nullable=False)
    created_at = Column(TIMESTAMP, server_default=func.now(), nullable=False)

    asset = relationship("Asset", back_populates="files")
    asset_version = relationship("AssetVersion", back_populates="files")


class Asset(Base):
    __tablename__ = "assets"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title = Column(String(512), nullable=True)
    owner_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    import_batch_id = Column(
        UUID(as_uuid=True),
        ForeignKey("import_batches.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at = Column(TIMESTAMP, server_default=func.now(), nullable=False)
    updated_at = Column(
        TIMESTAMP,
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
    lifecycle_status = Column(
        String(32),
        nullable=False,
        default=ASSET_LIFECYCLE_ACTIVE,
    )
    trashed_at = Column(TIMESTAMP, nullable=True)
    trashed_by_user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    duplicate_review_status = Column(
        String(32),
        nullable=False,
        default=DUPLICATE_REVIEW_PENDING,
    )
    duplicate_of_asset_id = Column(
        UUID(as_uuid=True),
        ForeignKey("assets.id", ondelete="SET NULL"),
        nullable=True,
    )

    owner = relationship(
        "User",
        foreign_keys=[owner_id],
        back_populates="assets",
    )
    import_batch = relationship("ImportBatch", back_populates="assets")
    files = relationship("File", back_populates="asset", cascade="all, delete-orphan")
    versions = relationship(
        "AssetVersion",
        back_populates="asset",
        cascade="all, delete-orphan",
        order_by="AssetVersion.version_number",
    )
    duplicate_of_asset = relationship(
        "Asset",
        remote_side=[id],
        foreign_keys=[duplicate_of_asset_id],
    )
    duplicate_candidates_as_source = relationship(
        "AssetDuplicateCandidate",
        foreign_keys="AssetDuplicateCandidate.source_asset_id",
        back_populates="source_asset",
    )
    duplicate_candidates_as_candidate = relationship(
        "AssetDuplicateCandidate",
        foreign_keys="AssetDuplicateCandidate.candidate_asset_id",
        back_populates="candidate_asset",
    )


class AssetVersion(Base):
    __tablename__ = "asset_versions"
    __table_args__ = (
        UniqueConstraint("asset_id", "version_number", name="uq_asset_version"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    asset_id = Column(
        UUID(as_uuid=True),
        ForeignKey("assets.id", ondelete="CASCADE"),
        nullable=False,
    )
    base_version_id = Column(
        UUID(as_uuid=True),
        ForeignKey("asset_versions.id", ondelete="SET NULL"),
        nullable=True,
    )
    version_number = Column(Integer, nullable=False, default=1)
    recipe = Column(JSONB, nullable=False, default=dict)
    status = Column(String(32), nullable=False, default=VERSION_STATUS_UPLOADED)
    preview_status = Column(String(32), nullable=False, default=TASK_STATUS_PENDING)
    preview_error = Column(Text, nullable=True)
    faces_status = Column(String(32), nullable=False, default=TASK_STATUS_PENDING)
    faces_error = Column(Text, nullable=True)
    exif = Column(JSONB, nullable=True)
    iptc = Column(JSONB, nullable=True)
    xmp = Column(JSONB, nullable=True)
    other = Column(JSONB, nullable=True)
    rating = Column(Integer, nullable=True)
    keywords = Column(JSONB, nullable=False, default=list)
    rendered_width = Column(Integer, nullable=True)
    rendered_height = Column(Integer, nullable=True)
    is_identity_source = Column(Boolean, nullable=False, default=False)
    created_at = Column(TIMESTAMP, server_default=func.now(), nullable=False)

    sha256 = Column(String(64), nullable=True, index=True)
    phash = Column(String(32), nullable=True, index=True)
    dhash = Column(String(32), nullable=True, index=True)
    semantic_embedding = Column(Vector(512), nullable=True)

    asset = relationship("Asset", back_populates="versions")
    base_version = relationship(
        "AssetVersion",
        remote_side=[id],
        backref="derived_versions",
    )
    files = relationship("File", back_populates="asset_version")
    face_detections = relationship(
        "FaceDetection",
        back_populates="asset_version",
        cascade="all, delete-orphan",
        order_by="FaceDetection.face_index",
    )


class AssetDuplicateCandidate(Base):
    __tablename__ = "asset_duplicate_candidates"
    __table_args__ = (
        UniqueConstraint(
            "source_asset_id",
            "candidate_asset_id",
            name="uq_asset_duplicate_candidate_pair",
        ),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    source_asset_id = Column(
        UUID(as_uuid=True),
        ForeignKey("assets.id", ondelete="CASCADE"),
        nullable=False,
    )
    candidate_asset_id = Column(
        UUID(as_uuid=True),
        ForeignKey("assets.id", ondelete="CASCADE"),
        nullable=False,
    )

    duplicate_type = Column(String(32), nullable=False)
    score = Column(Float, nullable=True)
    distance = Column(Integer, nullable=True)
    rank = Column(Integer, nullable=False)

    review_decision = Column(String(32), nullable=True)
    reviewed_at = Column(TIMESTAMP, nullable=True)
    reviewed_by_user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    created_at = Column(TIMESTAMP, server_default=func.now(), nullable=False)

    source_asset = relationship(
        "Asset",
        foreign_keys=[source_asset_id],
        back_populates="duplicate_candidates_as_source",
    )
    candidate_asset = relationship(
        "Asset",
        foreign_keys=[candidate_asset_id],
        back_populates="duplicate_candidates_as_candidate",
    )


def apply_version_status(version: AssetVersion) -> None:
    version.status = derive_version_status(
        version.preview_status,
        version.faces_status,
    )
