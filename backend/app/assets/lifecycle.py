import uuid
from pathlib import Path

from sqlalchemy.orm import Session

from app.assets.models import Asset, AssetDuplicateCandidate, File as AssetFileModel
from app.config import settings
from app.faces.models import FaceDetection


def collect_asset_relative_paths(db: Session, asset_id: uuid.UUID) -> list[str]:
    paths: list[str] = []
    for (p,) in db.query(AssetFileModel.path).filter_by(asset_id=asset_id).all():
        if p:
            paths.append(p)
    for (cp,) in (
        db.query(FaceDetection.crop_path).filter(FaceDetection.asset_id == asset_id).all()
    ):
        if cp:
            paths.append(cp)
    return paths


def unlink_asset_rel_paths(rel_paths: list[str]) -> None:
    root = Path(settings.storage_root).resolve()
    seen: set[Path] = set()
    for rel in rel_paths:
        if not rel or Path(rel).is_absolute():
            continue
        try:
            full = (root / rel).resolve()
            full.relative_to(root)
        except (OSError, ValueError):
            continue
        if full in seen:
            continue
        seen.add(full)
        try:
            if full.is_file():
                full.unlink(missing_ok=True)
        except OSError:
            pass


def prepare_asset_hard_delete(db: Session, asset_id: uuid.UUID) -> None:
    db.query(AssetDuplicateCandidate).filter(
        (AssetDuplicateCandidate.source_asset_id == asset_id)
        | (AssetDuplicateCandidate.candidate_asset_id == asset_id),
    ).delete(synchronize_session=False)
    db.query(Asset).filter(Asset.duplicate_of_asset_id == asset_id).update(
        {Asset.duplicate_of_asset_id: None},
        synchronize_session=False,
    )


def hard_delete_asset(db: Session, asset: Asset) -> uuid.UUID | None:
    """Полностью удаляет ассет и файлы на диске. Возвращает import_batch_id до удаления."""
    import_batch_id = asset.import_batch_id
    asset_id = asset.id
    paths = collect_asset_relative_paths(db, asset_id)
    prepare_asset_hard_delete(db, asset_id)
    db.delete(asset)
    db.commit()
    unlink_asset_rel_paths(paths)
    return import_batch_id
