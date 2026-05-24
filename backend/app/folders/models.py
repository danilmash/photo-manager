import uuid

from sqlalchemy import Column, ForeignKey, String, TIMESTAMP, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.database import Base


class Folder(Base):
    __tablename__ = "folders"
    __table_args__ = (
        UniqueConstraint("owner_id", "name", name="uq_folders_owner_name"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(256), nullable=False)
    owner_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    created_at = Column(TIMESTAMP, server_default=func.now(), nullable=False)
    updated_at = Column(
        TIMESTAMP,
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    owner = relationship("User", backref="folders")
    folder_assets = relationship(
        "FolderAsset",
        back_populates="folder",
        cascade="all, delete-orphan",
    )


class FolderAsset(Base):
    __tablename__ = "folder_assets"

    folder_id = Column(
        UUID(as_uuid=True),
        ForeignKey("folders.id", ondelete="CASCADE"),
        primary_key=True,
    )
    asset_id = Column(
        UUID(as_uuid=True),
        ForeignKey("assets.id", ondelete="CASCADE"),
        primary_key=True,
        index=True,
    )
    created_at = Column(TIMESTAMP, server_default=func.now(), nullable=False)

    folder = relationship("Folder", back_populates="folder_assets")
    asset = relationship("Asset", backref="folder_links")
