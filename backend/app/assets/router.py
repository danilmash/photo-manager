import uuid as uuid_mod
import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, UploadFile, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.users.dependencies import get_current_user
from app.users.models import User
from app.config import settings
from app.assets.models import Asset, File as AssetFileModel
from app.assets.schemas import UploadResponseSchema, AssetStatusSchema
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


@router.get("/{asset_id}/status", response_model=AssetStatusSchema)
def get_asset_status(
    asset_id: uuid_mod.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    asset = db.query(Asset).filter_by(id=asset_id, owner_id=current_user.id).first()
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ассет не найден")

    return AssetStatusSchema(asset_id=asset.id, status=asset.status)
