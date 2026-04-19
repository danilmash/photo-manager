from sqlalchemy import (
    Column, String, Integer, BigInteger, Text, ForeignKey, UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID, TIMESTAMP, JSONB
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.database import Base
import uuid


class File(Base):
    __tablename__ = "files"

    id         = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    asset_id   = Column(UUID(as_uuid=True), ForeignKey("assets.id", ondelete="CASCADE"), nullable=False)
    filename   = Column(String(512), nullable=False)
    mime_type  = Column(String(128), nullable=False)
    width      = Column(Integer, nullable=True)
    height     = Column(Integer, nullable=True)
    size_bytes = Column(BigInteger, nullable=False)
    path       = Column(Text, nullable=False)
    purpose    = Column(String(32), nullable=False)
    created_at = Column(TIMESTAMP, server_default=func.now(), nullable=False)

    asset = relationship("Asset", back_populates="files")


class Asset(Base):
    __tablename__ = "assets"

    id         = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title      = Column(String(512), nullable=True)
    status     = Column(String(32), nullable=False, default="importing")
    owner_id   = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)

    # Партия импорта, в рамках которой загружен ассет. NULL допустим только
    # для исторических данных, созданных до появления import_batches.
    import_batch_id = Column(
        UUID(as_uuid=True),
        ForeignKey("import_batches.id", ondelete="SET NULL"),
        nullable=True,
    )

    created_at = Column(TIMESTAMP, server_default=func.now(), nullable=False)
    updated_at = Column(TIMESTAMP, server_default=func.now(), onupdate=func.now(), nullable=False)

    owner    = relationship("User", backref="assets")
    import_batch = relationship("ImportBatch", back_populates="assets")
    files    = relationship("File", back_populates="asset", cascade="all, delete-orphan")
    versions = relationship(
        "AssetVersion", back_populates="asset",
        cascade="all, delete-orphan",
        order_by="AssetVersion.version_number",
    )


class AssetVersion(Base):
    __tablename__ = "asset_versions"
    __table_args__ = (
        UniqueConstraint("asset_id", "version_number", name="uq_asset_version"),
    )

    id             = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    asset_id       = Column(UUID(as_uuid=True), ForeignKey("assets.id", ondelete="CASCADE"), nullable=False)
    version_number = Column(Integer, nullable=False, default=1)
    recipe         = Column(JSONB, nullable=False, default=dict)
    exif           = Column(JSONB, nullable=True)
    iptc           = Column(JSONB, nullable=True)
    xmp            = Column(JSONB, nullable=True)
    other          = Column(JSONB, nullable=True)
    rating         = Column(Integer, nullable=True)
    keywords       = Column(JSONB, nullable=False, default=list)
    created_at     = Column(TIMESTAMP, server_default=func.now(), nullable=False)

    asset = relationship("Asset", back_populates="versions")
