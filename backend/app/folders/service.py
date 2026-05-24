import uuid as uuid_mod

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.assets.models import ASSET_LIFECYCLE_ACTIVE, Asset
from app.folders.models import Folder, FolderAsset
from app.folders.schemas import FolderSummarySchema
from app.users.models import User


def normalize_folder_name(name: str) -> str:
    normalized = " ".join(name.strip().split())
    if not normalized:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Имя папки не может быть пустым",
        )
    return normalized


def require_folder(
    db: Session,
    folder_id: uuid_mod.UUID,
    current_user: User,
) -> Folder:
    folder = (
        db.query(Folder)
        .filter(Folder.id == folder_id, Folder.owner_id == current_user.id)
        .first()
    )
    if not folder:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Папка не найдена",
        )
    return folder


def require_owned_asset(db: Session, asset_id: uuid_mod.UUID, current_user: User) -> Asset:
    asset = db.query(Asset).filter(Asset.id == asset_id).first()
    if not asset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Ассет не найден",
        )
    if asset.owner_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Нет доступа к ассету",
        )
    return asset


def folder_asset_count(db: Session, folder_id: uuid_mod.UUID) -> int:
    return (
        db.query(func.count(FolderAsset.asset_id))
        .join(Asset, Asset.id == FolderAsset.asset_id)
        .filter(
            FolderAsset.folder_id == folder_id,
            Asset.lifecycle_status == ASSET_LIFECYCLE_ACTIVE,
        )
        .scalar()
        or 0
    )


def build_folder_summary(db: Session, folder: Folder) -> FolderSummarySchema:
    return FolderSummarySchema(
        id=folder.id,
        name=folder.name,
        asset_count=folder_asset_count(db, folder.id),
        created_at=folder.created_at,
        updated_at=folder.updated_at,
    )


def list_asset_folders(
    db: Session,
    asset_id: uuid_mod.UUID,
    current_user: User,
) -> list[FolderSummarySchema]:
    require_owned_asset(db, asset_id, current_user)
    folders = (
        db.query(Folder)
        .join(FolderAsset, FolderAsset.folder_id == Folder.id)
        .filter(
            FolderAsset.asset_id == asset_id,
            Folder.owner_id == current_user.id,
        )
        .order_by(Folder.name.asc())
        .all()
    )
    return [build_folder_summary(db, folder) for folder in folders]
