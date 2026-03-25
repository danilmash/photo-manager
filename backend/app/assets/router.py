import uuid as uuid_mod
import shutil
import base64
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, UploadFile, HTTPException, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import select

from app.database import get_db
from app.users.dependencies import get_current_user
from app.users.models import User
from app.config import settings
from app.assets.models import Asset, File as AssetFileModel
from app.assets.schemas import (
    UploadResponseSchema,
    AssetStatusSchema,
    AssetListItemSchema,
    AssetListResponseSchema,
)
from app.assets.tasks import process_asset

router = APIRouter(prefix="/api/v1/assets", tags=["assets"])

ALLOWED_MIME_TYPES = {
    "image/jpeg",
    "image/png",
    "image/tiff",
    "image/webp",
    "image/heic",
    "image/heif",
}


def _encode_cursor(created_at: datetime, asset_id: uuid_mod.UUID) -> str:
    raw = f"{created_at.isoformat()}|{asset_id}"
    return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("utf-8")


def _decode_cursor(cursor: str) -> tuple[datetime, uuid_mod.UUID]:
    raw = base64.urlsafe_b64decode(cursor.encode("utf-8")).decode("utf-8")
    created_at_s, asset_id_s = raw.split("|", 1)
    return datetime.fromisoformat(created_at_s), uuid_mod.UUID(asset_id_s)


@router.post("/upload", response_model=UploadResponseSchema)
def upload_asset(
    file: UploadFile,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    content_type = file.content_type or ""
    if content_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Неподдерживаемый формат: {content_type}",
        )

    asset_id = uuid_mod.uuid4()
    file_id = uuid_mod.uuid4()
    filename = file.filename or str(file_id)

    asset_dir = Path(settings.storage_root) / "originals" / str(asset_id)
    asset_dir.mkdir(parents=True, exist_ok=True)
    dest = asset_dir / filename

    with open(dest, "wb") as buf:
        shutil.copyfileobj(file.file, buf)

    size_bytes = dest.stat().st_size
    relative_path = f"originals/{asset_id}/{filename}"

    asset = Asset(
        id=asset_id,
        title=filename,
        status="importing",
        owner_id=current_user.id,
    )
    file_record = AssetFileModel(
        id=file_id,
        asset_id=asset_id,
        filename=filename,
        mime_type=content_type,
        size_bytes=size_bytes,
        path=relative_path,
        purpose="original",
    )
    db.add(asset)
    db.add(file_record)
    db.commit()

    task = process_asset.delay(str(asset_id), str(file_id))

    return UploadResponseSchema(
        asset_id=asset_id,
        job_id=task.id,
        filename=filename,
        status="importing",
    )


@router.get("", response_model=AssetListResponseSchema)
def list_assets(
    limit: int = 50,
    cursor: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # shared library: auth required, but no owner filter
    limit = max(1, min(limit, 200))

    thumb_sq = (
        select(AssetFileModel)
        .where(AssetFileModel.purpose == "thumbnail")
        .distinct(AssetFileModel.asset_id)
        .order_by(AssetFileModel.asset_id, AssetFileModel.created_at.desc())
        .subquery()
    )

    q = (
        db.query(Asset, thumb_sq.c.id.label("thumb_id"))
        .outerjoin(thumb_sq, thumb_sq.c.asset_id == Asset.id)
        .order_by(Asset.created_at.desc(), Asset.id.desc())
    )

    if cursor:
        c_created_at, c_asset_id = _decode_cursor(cursor)
        q = q.filter(
            (Asset.created_at < c_created_at)
            | ((Asset.created_at == c_created_at) & (Asset.id < c_asset_id))
        )

    rows = q.limit(limit + 1).all()
    has_more = len(rows) > limit
    rows = rows[:limit]

    items: list[AssetListItemSchema] = []
    for asset, thumb_id in rows:
        items.append(
            AssetListItemSchema(
                asset_id=asset.id,
                title=asset.title,
                status=asset.status,
                created_at=asset.created_at,
                thumbnail_file_id=thumb_id,
                thumbnail_url=(f"/api/v1/assets/files/{thumb_id}" if thumb_id else None),
            )
        )

    next_cursor = None
    if has_more and rows:
        last_asset = rows[-1][0]
        next_cursor = _encode_cursor(last_asset.created_at, last_asset.id)

    return AssetListResponseSchema(items=items, next_cursor=next_cursor)


@router.get("/files/{file_id}")
def get_asset_file(
    file_id: uuid_mod.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    f = db.query(AssetFileModel).filter_by(id=file_id).first()
    if not f:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Файл не найден")

    path = Path(settings.storage_root) / f.path
    if not path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Файл отсутствует на диске")

    return FileResponse(path, media_type=f.mime_type, filename=f.filename)


@router.get("/{asset_id}/status", response_model=AssetStatusSchema)
def get_asset_status(
    asset_id: uuid_mod.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    asset = db.query(Asset).filter_by(id=asset_id).first()
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ассет не найден")

    return AssetStatusSchema(asset_id=asset.id, status=asset.status)
