import uuid

from fastapi import HTTPException, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.users.models import User
from app.users.schemas import ALLOWED_ROLES, UserCreate, UserUpdate
from app.users.security import hash_password, verify_password

LAST_ADMIN_DETAIL = "Нельзя удалить последнего администратора"


def count_active_admins(db: Session, *, exclude_user_id: uuid.UUID | None = None) -> int:
    q = db.query(User).filter(User.role == "admin", User.is_active.is_(True))
    if exclude_user_id is not None:
        q = q.filter(User.id != exclude_user_id)
    return q.count()


def _would_remove_active_admin(user: User, update: UserUpdate) -> bool:
    if user.role != "admin" or not user.is_active:
        return False
    new_role = update.role if update.role is not None else user.role
    new_active = update.is_active if update.is_active is not None else user.is_active
    return new_role != "admin" or not new_active


def ensure_not_last_admin(
    db: Session,
    target: User,
    update: UserUpdate,
    *,
    actor: User,
) -> None:
    if not _would_remove_active_admin(target, update):
        return

    remaining = count_active_admins(db, exclude_user_id=target.id)
    if remaining > 0:
        return

    if actor.id == target.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=LAST_ADMIN_DETAIL,
        )
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=LAST_ADMIN_DETAIL,
    )


def create_user(db: Session, body: UserCreate) -> User:
    if body.role not in ALLOWED_ROLES:
        raise HTTPException(status_code=400, detail="Недопустимая роль")

    existing = db.query(User).filter_by(email=body.email).first()
    if existing:
        raise HTTPException(status_code=409, detail="Email уже занят")

    user = User(
        email=body.email,
        display_name=body.display_name,
        password_hash=hash_password(body.password),
        role=body.role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def update_user(db: Session, user: User, body: UserUpdate, *, actor: User) -> User:
    if body.role is not None and body.role not in ALLOWED_ROLES:
        raise HTTPException(status_code=400, detail="Недопустимая роль")

    if not any(v is not None for v in (body.display_name, body.role, body.is_active)):
        raise HTTPException(status_code=400, detail="Нужно указать хотя бы одно поле")

    patch = UserUpdate(
        display_name=body.display_name,
        role=body.role,
        is_active=body.is_active,
    )
    ensure_not_last_admin(db, user, patch, actor=actor)

    if body.display_name is not None:
        user.display_name = body.display_name
    if body.role is not None:
        user.role = body.role
    if body.is_active is not None:
        user.is_active = body.is_active

    db.commit()
    db.refresh(user)
    return user


def reset_user_password(db: Session, user: User, new_password: str) -> None:
    user.password_hash = hash_password(new_password)
    db.commit()


def update_me(
    db: Session,
    user: User,
    *,
    display_name: str | None,
    current_password: str | None,
    new_password: str | None,
) -> User:
    if display_name is None and new_password is None:
        raise HTTPException(status_code=400, detail="Нужно указать хотя бы одно поле")

    if new_password is not None:
        if not current_password:
            raise HTTPException(
                status_code=400,
                detail="Укажите current_password для смены пароля",
            )
        if not verify_password(current_password, user.password_hash):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Неверный текущий пароль",
            )
        user.password_hash = hash_password(new_password)

    if display_name is not None:
        user.display_name = display_name

    db.commit()
    db.refresh(user)
    return user


def list_users(
    db: Session,
    *,
    limit: int,
    offset: int,
    role: str | None,
    is_active: bool | None,
    q: str | None,
) -> tuple[list[User], int]:
    query = db.query(User)

    if role is not None:
        if role not in ALLOWED_ROLES:
            raise HTTPException(status_code=400, detail="Недопустимая роль")
        query = query.filter(User.role == role)
    if is_active is not None:
        query = query.filter(User.is_active == is_active)
    if q:
        pattern = f"%{q.strip()}%"
        query = query.filter(
            or_(User.email.ilike(pattern), User.display_name.ilike(pattern))
        )

    total = query.count()
    items = (
        query.order_by(User.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return items, total
