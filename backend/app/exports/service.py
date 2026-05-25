from __future__ import annotations

import datetime
import uuid
from dataclasses import dataclass
from pathlib import Path

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.assets.models import ASSET_LIFECYCLE_ACTIVE, Asset, AssetVersion, File
from app.config import settings
from app.exports.models import (
    EXPORT_STATUS_PENDING,
    ExportJob,
)

MAX_EXPORT_ASSETS = 200
EXPORT_TTL_HOURS = 24


@dataclass
class ExportAssetItem:
    asset_id: uuid.UUID
    title: str | None
    original_path: Path
    source_filename: str
    source_mime: str | None
    recipe: dict | None


def dedupe_asset_ids(asset_ids: list[uuid.UUID]) -> list[uuid.UUID]:
    seen: set[uuid.UUID] = set()
    unique: list[uuid.UUID] = []
    for asset_id in asset_ids:
        if asset_id in seen:
            continue
        seen.add(asset_id)
        unique.append(asset_id)
    return unique


def validate_export_request(asset_ids: list[uuid.UUID]) -> list[uuid.UUID]:
    unique_ids = dedupe_asset_ids(asset_ids)
    if not unique_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Список фотографий для экспорта пуст",
        )
    if len(unique_ids) > MAX_EXPORT_ASSETS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Можно экспортировать не более {MAX_EXPORT_ASSETS} фотографий за раз",
        )
    return unique_ids


def _get_original_file(db: Session, asset_id: uuid.UUID) -> File | None:
    return (
        db.query(File)
        .filter_by(asset_id=asset_id, purpose="original")
        .order_by(File.created_at.desc())
        .first()
    )


def _get_latest_version(db: Session, asset_id: uuid.UUID) -> AssetVersion | None:
    return (
        db.query(AssetVersion)
        .filter_by(asset_id=asset_id)
        .order_by(AssetVersion.version_number.desc())
        .first()
    )


def resolve_export_assets(db: Session, asset_ids: list[uuid.UUID]) -> list[ExportAssetItem]:
    assets = (
        db.query(Asset)
        .filter(Asset.id.in_(asset_ids))
        .filter(Asset.lifecycle_status == ASSET_LIFECYCLE_ACTIVE)
        .all()
    )
    assets_by_id = {asset.id: asset for asset in assets}

    missing = [str(asset_id) for asset_id in asset_ids if asset_id not in assets_by_id]
    if missing:
        raise ValueError("Некоторые фотографии не найдены или находятся в корзине")

    items: list[ExportAssetItem] = []
    storage_root = Path(settings.storage_root)

    for asset_id in asset_ids:
        asset = assets_by_id[asset_id]
        original_file = _get_original_file(db, asset.id)
        if not original_file:
            raise ValueError(f"Оригинальный файл не найден для фото {asset.id}")

        original_path = storage_root / original_file.path
        if not original_path.exists():
            raise ValueError(f"Файл на диске отсутствует для фото {asset.id}")

        latest_version = _get_latest_version(db, asset.id)
        items.append(
            ExportAssetItem(
                asset_id=asset.id,
                title=asset.title,
                original_path=original_path,
                source_filename=original_file.filename,
                source_mime=original_file.mime_type,
                recipe=latest_version.recipe if latest_version else None,
            )
        )

    return items


def create_export_job(
    db: Session,
    *,
    user_id: uuid.UUID,
    asset_ids: list[uuid.UUID],
) -> ExportJob:
    validated_ids = validate_export_request(asset_ids)
    try:
        resolve_export_assets(db, validated_ids)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc

    now = datetime.datetime.now(datetime.timezone.utc)
    job = ExportJob(
        user_id=user_id,
        status=EXPORT_STATUS_PENDING,
        asset_ids=[str(asset_id) for asset_id in validated_ids],
        total=len(validated_ids),
        processed=0,
        expires_at=now + datetime.timedelta(hours=EXPORT_TTL_HOURS),
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def get_export_job_or_404(db: Session, job_id: uuid.UUID) -> ExportJob:
    job = db.query(ExportJob).filter_by(id=job_id).first()
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Задача экспорта не найдена",
        )
    return job


def export_zip_relative_path(job_id: uuid.UUID) -> str:
    return f"exports/{job_id}.zip"


def export_zip_absolute_path(job_id: uuid.UUID) -> Path:
    return Path(settings.storage_root) / export_zip_relative_path(job_id)
