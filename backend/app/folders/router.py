import uuid as uuid_mod

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.folders.models import Folder
from app.folders.schemas import (
    FolderCreateRequest,
    FolderListResponseSchema,
    FolderSummarySchema,
    FolderUpdateRequest,
)
from app.folders.service import (
    build_folder_summary,
    normalize_folder_name,
    require_folder,
)
from app.users.dependencies import get_current_user
from app.users.models import User

router = APIRouter(prefix="/api/v1/folders", tags=["folders"])


@router.get("", response_model=FolderListResponseSchema)
def list_folders(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    folders = (
        db.query(Folder)
        .filter(Folder.owner_id == current_user.id)
        .order_by(Folder.name.asc())
        .all()
    )
    return FolderListResponseSchema(
        items=[build_folder_summary(db, folder) for folder in folders],
    )


@router.post("", response_model=FolderSummarySchema, status_code=status.HTTP_201_CREATED)
def create_folder(
    body: FolderCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    name = normalize_folder_name(body.name)
    folder = Folder(name=name, owner_id=current_user.id)
    db.add(folder)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Папка с таким именем уже существует",
        ) from exc
    db.refresh(folder)
    return build_folder_summary(db, folder)


@router.patch("/{folder_id}", response_model=FolderSummarySchema)
def update_folder(
    folder_id: uuid_mod.UUID,
    body: FolderUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    folder = require_folder(db, folder_id, current_user)
    folder.name = normalize_folder_name(body.name)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Папка с таким именем уже существует",
        ) from exc
    db.refresh(folder)
    return build_folder_summary(db, folder)


@router.delete("/{folder_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_folder(
    folder_id: uuid_mod.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    folder = require_folder(db, folder_id, current_user)
    db.delete(folder)
    db.commit()
    return None
