from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field

UserRole = Literal["admin", "editor"]
ALLOWED_ROLES: tuple[str, ...] = ("admin", "editor")
MIN_PASSWORD_LENGTH = 8


class UserPublic(BaseModel):
    id: UUID
    email: EmailStr
    display_name: str
    role: str
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class UserListResponse(BaseModel):
    items: list[UserPublic]
    total: int
    limit: int
    offset: int


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=MIN_PASSWORD_LENGTH)
    display_name: str = Field(min_length=1, max_length=256)
    role: UserRole = "editor"


class UserUpdate(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=256)
    role: UserRole | None = None
    is_active: bool | None = None


class UserPasswordReset(BaseModel):
    new_password: str = Field(min_length=MIN_PASSWORD_LENGTH)


class MeUpdate(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=256)
    current_password: str | None = None
    new_password: str | None = Field(default=None, min_length=MIN_PASSWORD_LENGTH)


class StatusResponse(BaseModel):
    status: str = "ok"
