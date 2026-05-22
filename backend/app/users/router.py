from fastapi import APIRouter, Depends, HTTPException, status, Response
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr

from app.database import get_db
from app.users.models import User
from app.users.security import verify_password, create_access_token
from app.users.dependencies import require_admin, get_current_user
from app.users.schemas import MeUpdate, UserCreate, UserPublic
from app.users.services import create_user, update_me

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class LoginUserResponse(BaseModel):
    user: UserPublic


@router.post("/register", deprecated=True, dependencies=[Depends(require_admin)])
def register(body: UserCreate, db: Session = Depends(get_db)):
    """Устарело: используйте POST /api/v1/users."""
    user = create_user(db, body)
    return UserPublic.model_validate(user)


@router.post("/login", response_model=LoginUserResponse)
def login(body: LoginRequest, response: Response, db: Session = Depends(get_db)):
    user = db.query(User).filter_by(email=body.email).first()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверный email или пароль",
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Аккаунт деактивирован",
        )

    token = create_access_token(str(user.id), user.role)

    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        samesite="lax",
        secure=False,
        max_age=60 * 60 * 24,
    )

    return LoginUserResponse(user=UserPublic.model_validate(user))


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie("access_token")
    return {"status": "ok"}


@router.get("/me", response_model=UserPublic)
def me(current_user: User = Depends(get_current_user)):
    return UserPublic.model_validate(current_user)


@router.patch("/me", response_model=UserPublic)
def patch_me(
    body: MeUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    user = update_me(
        db,
        current_user,
        display_name=body.display_name,
        current_password=body.current_password,
        new_password=body.new_password,
    )
    return UserPublic.model_validate(user)
