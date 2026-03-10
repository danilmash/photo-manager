from contextlib import asynccontextmanager
from fastapi import FastAPI
from app.config import settings
from app.database import SessionLocal
from app.users.router import router as auth_router
from app.users.models import User
from app.users.security import hash_password

@asynccontextmanager
async def lifespan(app: FastAPI):
    # startup
    db = SessionLocal()
    try:
        existing = db.query(User).filter_by(role="admin").first()
        if not existing:
            db.add(User(
                email=settings.admin_email,
                display_name="Admin",
                password_hash=hash_password(settings.admin_password),
                role="admin",
            ))
            db.commit()
            print(f"✓ Создан admin: {settings.admin_email}")
    finally:
        db.close()

    yield

    # shutdown 

app = FastAPI(title="PhotoVault API", lifespan=lifespan)

app.include_router(auth_router)


@app.get("/")
async def root():
    return {"status": "ok"}