from fastapi import APIRouter, Depends, HTTPException, status, Response
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr

from app.database import get_db
from app.users.models import User
from app.users.security import hash_password, verify_password, create_access_token
from app.users.dependencies import require_admin, get_current_user

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

class LoginRequest(BaseModel):
    email: EmailStr 
    password: str

class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    display_name: str
    role: str = "editor"  # editor | viewer

@router.post("/register", dependencies=[Depends(require_admin)])
def register(body: RegisterRequest, db: Session = Depends(get_db)):
    if body.role not in ("admin", "editor", "viewer"):
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

    return {
        "id": str(user.id),
        "email": user.email,
        "display_name": user.display_name,
        "role": user.role,
    }

@router.post("/login")
def login(body: LoginRequest, response: Response, db: Session = Depends(get_db)):
    user = db.query(User).filter_by(email=body.email).first()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверный email или пароль"
        )
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Аккаунт деактивирован")
    
    token = create_access_token(str(user.id), user.role)

    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,      
        samesite="lax",      
        secure=False,       
        max_age=60 * 60 * 24
    )

    return {
        "user": {
            "id": str(user.id),
            "email": user.email,
            "display_name": user.display_name,
            "role": user.role,
        }
    }

@router.post("/logout")
def logout(response: Response):
    response.delete_cookie("access_token")
    return {"status": "ok"}

@router.get("/me")
def me(current_user: User = Depends(get_current_user)):
    return {
        "id": str(current_user.id),
        "email": current_user.email,
        "display_name": current_user.display_name,
        "role": current_user.role,
    }