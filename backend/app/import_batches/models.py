import uuid

from sqlalchemy import Column, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import TIMESTAMP, UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.database import Base


# Возможные значения ImportBatch.status. Храним строкой (как Asset.status),
# чтобы не вводить enum в БД и легко добавлять статусы в будущем.
IMPORT_BATCH_STATUS_UPLOADING = "uploading"
IMPORT_BATCH_STATUS_PENDING_REVIEW = "pending_review"
IMPORT_BATCH_STATUS_ACCEPTED = "accepted"
IMPORT_BATCH_STATUS_REJECTED = "rejected"
IMPORT_BATCH_STATUS_CANCELLED = "cancelled"


class ImportBatch(Base):
    __tablename__ = "import_batches"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # NULL = главная (общая) библиотека.
    # Заполняется только когда фича проектов включена в админ-настройках.
    project_id = Column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="SET NULL"),
        nullable=True,
    )

    status = Column(
        String(32),
        nullable=False,
        default=IMPORT_BATCH_STATUS_UPLOADING,
    )

    note = Column(Text, nullable=True)

    created_at = Column(TIMESTAMP, server_default=func.now(), nullable=False)
    updated_at = Column(
        TIMESTAMP,
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    project = relationship("Project", back_populates="import_batches")
    assets = relationship(
        "Asset",
        back_populates="import_batch",
    )
