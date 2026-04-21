from sqlalchemy import (
    Column, String, Integer, BigInteger, Text, ForeignKey, UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID, TIMESTAMP, JSONB
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.database import Base
import uuid


# Общие статусы ассета. Храним строкой, чтобы легко расширять набор без
# миграций enum. Значение всегда производное от preview_status/faces_status
# (см. derive_asset_status ниже).
ASSET_STATUS_UPLOADED = "uploaded"
ASSET_STATUS_PROCESSING = "processing"
ASSET_STATUS_READY = "ready"
ASSET_STATUS_PARTIAL_ERROR = "partial_error"
ASSET_STATUS_ERROR = "error"

# Статусы конкретной celery-задачи (preview/faces). Используем единый
# набор, чтобы одинаково обрабатывать любую фазу пайплайна.
TASK_STATUS_PENDING = "pending"
TASK_STATUS_PROCESSING = "processing"
TASK_STATUS_COMPLETED = "completed"
TASK_STATUS_FAILED = "failed"


def derive_asset_status(preview_status: str, faces_status: str) -> str:
    """Вычисляет общий asset.status из статусов отдельных фаз.

    Правила:
    * preview — обязательная фаза: её провал = общий error.
    * faces — опциональная: её провал при успешном preview = partial_error.
    * processing показываем, только если хотя бы одна фаза действительно
      выполняется; pending в расчёт не идёт.
    * "uploaded" покрывает как свежезагруженный ассет (обе фазы pending),
      так и промежуточное состояние «preview готов, faces ещё не
      запускались» (ML стартует только при закрытии партии).
    """
    if preview_status == TASK_STATUS_FAILED:
        return ASSET_STATUS_ERROR
    if preview_status == TASK_STATUS_PROCESSING or faces_status == TASK_STATUS_PROCESSING:
        return ASSET_STATUS_PROCESSING
    if preview_status == TASK_STATUS_COMPLETED and faces_status == TASK_STATUS_COMPLETED:
        return ASSET_STATUS_READY
    if preview_status == TASK_STATUS_COMPLETED and faces_status == TASK_STATUS_FAILED:
        return ASSET_STATUS_PARTIAL_ERROR
    return ASSET_STATUS_UPLOADED


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
    status     = Column(String(32), nullable=False, default=ASSET_STATUS_UPLOADED)
    owner_id   = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)

    # Статусы отдельных фаз пайплайна + последние ошибки. Общий status
    # всегда пересчитывается из этих полей через derive_asset_status.
    preview_status = Column(String(32), nullable=False, default=TASK_STATUS_PENDING)
    preview_error  = Column(Text, nullable=True)
    faces_status   = Column(String(32), nullable=False, default=TASK_STATUS_PENDING)
    faces_error    = Column(Text, nullable=True)

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


def apply_asset_status(asset: Asset) -> None:
    """Пересчитать общий asset.status из preview_status и faces_status."""
    asset.status = derive_asset_status(asset.preview_status, asset.faces_status)


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
