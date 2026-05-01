from sqlalchemy import (
    Column, String, Boolean, Text
)
from sqlalchemy.dialects.postgresql import UUID, TIMESTAMP
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base
import uuid
 
class User(Base):
    __tablename__ = "users"

    id            = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email         = Column(String(256), nullable=False, unique=True)
    display_name  = Column(String(256), nullable=False)
    password_hash = Column(Text, nullable=False)
    role          = Column(String(32), nullable=False, default="editor")
    is_active     = Column(Boolean, nullable=False, default=True)
    created_at    = Column(TIMESTAMP, server_default=func.now(), nullable=False)
    updated_at    = Column(TIMESTAMP, server_default=func.now(), onupdate=func.now(), nullable=False)

    assets = relationship(
        "Asset",
        foreign_keys="Asset.owner_id",
        back_populates="owner",
    )