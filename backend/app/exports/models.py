import uuid

from sqlalchemy import Column, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP, UUID
from sqlalchemy.sql import func

from app.database import Base

EXPORT_STATUS_PENDING = "pending"
EXPORT_STATUS_PROCESSING = "processing"
EXPORT_STATUS_COMPLETED = "completed"
EXPORT_STATUS_FAILED = "failed"


class ExportJob(Base):
    __tablename__ = "export_jobs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    status = Column(String(32), nullable=False, default=EXPORT_STATUS_PENDING)
    asset_ids = Column(JSONB, nullable=False)
    total = Column(Integer, nullable=False, default=0)
    processed = Column(Integer, nullable=False, default=0)
    zip_path = Column(String(512), nullable=True)
    error = Column(Text, nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)
    expires_at = Column(TIMESTAMP(timezone=True), nullable=True)
