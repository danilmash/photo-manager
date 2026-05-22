import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.users.dependencies import require_admin
from app.users.models import User
from app.users.schemas import (
    StatusResponse,
    UserCreate,
    UserListResponse,
    UserPasswordReset,
    UserPublic,
    UserUpdate,
)
from app.users.services import create_user, list_users, reset_user_password, update_user

router = APIRouter(
    prefix="/api/v1/users",
    tags=["users"],
    dependencies=[Depends(require_admin)],
)


@router.get("", response_model=UserListResponse)
def get_users(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    role: str | None = Query(default=None),
    is_active: bool | None = Query(default=None),
    q: str | None = Query(default=None, max_length=256),
    db: Session = Depends(get_db),
):
    items, total = list_users(
        db,
        limit=limit,
        offset=offset,
        role=role,
        is_active=is_active,
        q=q,
    )
    return UserListResponse(
        items=[UserPublic.model_validate(u) for u in items],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post("", response_model=UserPublic, status_code=status.HTTP_201_CREATED)
def post_user(body: UserCreate, db: Session = Depends(get_db)):
    user = create_user(db, body)
    return UserPublic.model_validate(user)


@router.get("/{user_id}", response_model=UserPublic)
def get_user(user_id: uuid.UUID, db: Session = Depends(get_db)):
    user = db.query(User).filter_by(id=user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    return UserPublic.model_validate(user)


@router.patch("/{user_id}", response_model=UserPublic)
def patch_user(
    user_id: uuid.UUID,
    body: UserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    user = db.query(User).filter_by(id=user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    user = update_user(db, user, body, actor=current_user)
    return UserPublic.model_validate(user)


@router.post("/{user_id}/reset-password", response_model=StatusResponse)
def post_reset_password(
    user_id: uuid.UUID,
    body: UserPasswordReset,
    db: Session = Depends(get_db),
):
    user = db.query(User).filter_by(id=user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    reset_user_password(db, user, body.new_password)
    return StatusResponse()
