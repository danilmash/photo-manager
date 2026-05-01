import base64
import shutil
import uuid as uuid_mod
from datetime import datetime
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, Depends, Form, HTTPException, Query, Response, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import and_
from sqlalchemy.orm import Session, joinedload

from app.assets.models import (
    ASSET_LIFECYCLE_ACTIVE,
    ASSET_LIFECYCLE_TRASHED,
    TASK_STATUS_COMPLETED,
    TASK_STATUS_FAILED,
    TASK_STATUS_PENDING,
    VERSION_STATUS_UPLOADED,
    Asset,
    AssetVersion,
    File as AssetFileModel,
    apply_version_status,
)
from app.assets.recipes import normalize_recipe
from app.assets.schemas import (
    AssetLifecycleResponseSchema,
    AssetListItemSchema,
    AssetListResponseSchema,
    AssetMetadataResponseSchema,
    AssetMetadataSchema,
    AssetPhotoInfoSchema,
    AssetVersionCreateRequest,
    AssetVersionHistoryResponseSchema,
    AssetVersionJobResponseSchema,
    AssetVersionStatusSchema,
    AssetVersionSummarySchema,
    AssetViewerFacePersonCandidateSchema,
    AssetViewerFaceSchema,
    AssetViewerResponseSchema,
    UploadResponseSchema,
)
from app.assets.tasks import process_asset_ml, process_asset_preview
from app.config import settings
from app.database import get_db
from app.faces.models import FaceCandidate, FaceDetection, FaceIdentity
from app.import_batches.models import (
    IMPORT_BATCH_STATUS_PENDING_REVIEW,
    IMPORT_BATCH_STATUS_PROCESSING,
    IMPORT_BATCH_STATUS_UPLOADING,
    ImportBatch,
)
from app.users.dependencies import get_current_user
from app.users.models import User

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


def _build_file_url(file_id: uuid_mod.UUID | None) -> str | None:
    if not file_id:
        return None
    return f"/api/v1/assets/files/{file_id}"


def _require_user_asset(db: Session, asset_id: uuid_mod.UUID, user: User) -> Asset:
    asset = (
        db.query(Asset)
        .filter(Asset.id == asset_id, Asset.owner_id == user.id)
        .first()
    )
    if not asset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Ассет не найден",
        )
    return asset


def _require_active_lifecycle(asset: Asset) -> None:
    if asset.lifecycle_status != ASSET_LIFECYCLE_ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Операция недоступна: ассет в корзине",
        )


def _require_trashed_lifecycle(asset: Asset) -> None:
    if asset.lifecycle_status != ASSET_LIFECYCLE_TRASHED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Полное удаление доступно только для ассетов в корзине",
        )


def _collect_asset_relative_paths(db: Session, asset_id: uuid_mod.UUID) -> list[str]:
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


def _unlink_asset_rel_paths(rel_paths: list[str]) -> None:
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


def _get_original_file(db: Session, asset_id: uuid_mod.UUID) -> AssetFileModel | None:
    return (
        db.query(AssetFileModel)
        .filter_by(asset_id=asset_id, purpose="original")
        .order_by(AssetFileModel.created_at.desc())
        .first()
    )


def _get_latest_version(
    db: Session,
    asset_id: uuid_mod.UUID,
) -> AssetVersion | None:
    return (
        db.query(AssetVersion)
        .filter_by(asset_id=asset_id)
        .order_by(AssetVersion.version_number.desc())
        .first()
    )


def _get_version_or_404(
    db: Session,
    asset_id: uuid_mod.UUID,
    *,
    version_id: uuid_mod.UUID | None = None,
    version_number: int | None = None,
) -> AssetVersion:
    if version_id is not None and version_number is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Нельзя передавать одновременно version_id и version_number",
        )

    query = db.query(AssetVersion).filter(AssetVersion.asset_id == asset_id)
    if version_id is not None:
        version = query.filter(AssetVersion.id == version_id).first()
    elif version_number is not None:
        version = query.filter(AssetVersion.version_number == version_number).first()
    else:
        version = query.order_by(AssetVersion.version_number.desc()).first()

    if not version:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Версия ассета не найдена",
        )
    return version


def _get_version_files_map(
    db: Session,
    version_ids: list[uuid_mod.UUID],
) -> dict[uuid_mod.UUID, dict[str, AssetFileModel]]:
    if not version_ids:
        return {}

    files = (
        db.query(AssetFileModel)
        .filter(
            AssetFileModel.asset_version_id.in_(version_ids),
            AssetFileModel.purpose.in_(("preview", "thumbnail")),
        )
        .all()
    )
    files_map: dict[uuid_mod.UUID, dict[str, AssetFileModel]] = {}
    for file_record in files:
        if file_record.asset_version_id is None:
            continue
        files_map.setdefault(file_record.asset_version_id, {})[file_record.purpose] = (
            file_record
        )
    return files_map


def _get_latest_versions_map(
    db: Session,
    asset_ids: list[uuid_mod.UUID],
) -> dict[uuid_mod.UUID, AssetVersion]:
    if not asset_ids:
        return {}

    latest_sq = (
        db.query(
            AssetVersion.asset_id.label("asset_id"),
            AssetVersion.version_number.label("version_number"),
        )
        .filter(AssetVersion.asset_id.in_(asset_ids))
        .distinct(AssetVersion.asset_id)
        .order_by(AssetVersion.asset_id, AssetVersion.version_number.desc())
        .subquery()
    )
    versions = (
        db.query(AssetVersion)
        .join(
            latest_sq,
            and_(
                AssetVersion.asset_id == latest_sq.c.asset_id,
                AssetVersion.version_number == latest_sq.c.version_number,
            ),
        )
        .all()
    )
    return {version.asset_id: version for version in versions}


def _normalize_keywords(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(x) for x in value]
    return []


def _deep_get(data: dict[str, Any] | None, *paths: str) -> Any | None:
    if not isinstance(data, dict):
        return None

    for path in paths:
        current: Any = data
        found = True
        for key in path.split("."):
            if isinstance(current, dict) and key in current:
                current = current[key]
            else:
                found = False
                break
        if found and current not in (None, "", [], {}):
            return current
    return None


def _build_version_summary(
    version: AssetVersion,
    version_files: dict[str, AssetFileModel] | None = None,
) -> AssetVersionSummarySchema:
    version_files = version_files or {}
    preview = version_files.get("preview")
    thumbnail = version_files.get("thumbnail")
    return AssetVersionSummarySchema(
        id=version.id,
        version_number=version.version_number,
        base_version_id=version.base_version_id,
        status=version.status,
        preview_status=version.preview_status,
        faces_status=version.faces_status,
        preview_error=version.preview_error,
        faces_error=version.faces_error,
        recipe=normalize_recipe(version.recipe),
        rendered_width=version.rendered_width,
        rendered_height=version.rendered_height,
        is_identity_source=version.is_identity_source,
        preview_file_id=preview.id if preview else None,
        preview_url=_build_file_url(preview.id if preview else None),
        thumbnail_file_id=thumbnail.id if thumbnail else None,
        thumbnail_url=_build_file_url(thumbnail.id if thumbnail else None),
        created_at=version.created_at,
    )


def _build_photo_info(
    version: AssetVersion | None,
    original_file: AssetFileModel | None,
) -> AssetPhotoInfoSchema:
    exif = version.exif if version and isinstance(version.exif, dict) else {}
    other = version.other if version and isinstance(version.other, dict) else {}

    return AssetPhotoInfoSchema(
        filename=original_file.filename if original_file else None,
        mime_type=original_file.mime_type if original_file else None,
        size_bytes=original_file.size_bytes if original_file else None,
        width=(
            version.rendered_width
            if version and version.rendered_width is not None
            else _deep_get(
                exif,
                "ImageWidth",
                "EXIF.ExifImageWidth",
                "Composite.ImageWidth",
            )
            or _deep_get(other, "width")
        ),
        height=(
            version.rendered_height
            if version and version.rendered_height is not None
            else _deep_get(
                exif,
                "ImageHeight",
                "EXIF.ExifImageHeight",
                "Composite.ImageHeight",
            )
            or _deep_get(other, "height")
        ),
        taken_at=_deep_get(
            exif,
            "DateTimeOriginal",
            "EXIF.DateTimeOriginal",
            "Composite.SubSecDateTimeOriginal",
        ),
        camera_make=_deep_get(exif, "Make", "IFD0.Make"),
        camera_model=_deep_get(exif, "Model", "IFD0.Model"),
        lens=_deep_get(exif, "LensModel", "EXIF.LensModel"),
        iso=_deep_get(exif, "ISOSpeedRatings", "EXIF.ISOSpeedRatings"),
        aperture=_deep_get(exif, "FNumber", "EXIF.FNumber"),
        shutter_speed=_deep_get(exif, "ExposureTime", "EXIF.ExposureTime"),
        focal_length=_deep_get(exif, "FocalLength", "EXIF.FocalLength"),
        rating=version.rating if version else None,
        keywords=_normalize_keywords(version.keywords if version else None),
    )


def _build_version_status_schema(version: AssetVersion) -> AssetVersionStatusSchema:
    return AssetVersionStatusSchema(
        asset_id=version.asset_id,
        version_id=version.id,
        version_number=version.version_number,
        status=version.status,
        preview_status=version.preview_status,
        faces_status=version.faces_status,
        preview_error=version.preview_error,
        faces_error=version.faces_error,
    )


@router.post("/upload", response_model=UploadResponseSchema)
def upload_asset(
    file: UploadFile,
    batch_id: uuid_mod.UUID | None = Form(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    content_type = file.content_type or ""
    if content_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Неподдерживаемый формат: {content_type}",
        )

    batch: ImportBatch | None = None
    if batch_id is not None:
        batch = db.query(ImportBatch).filter_by(id=batch_id).first()
        if not batch:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Партия импорта не найдена",
            )
        if batch.status != IMPORT_BATCH_STATUS_UPLOADING:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "В партию импорта нельзя добавлять файлы "
                    f"в статусе '{batch.status}'"
                ),
            )

    asset_id = uuid_mod.uuid4()
    file_id = uuid_mod.uuid4()
    version_id = uuid_mod.uuid4()
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
        owner_id=current_user.id,
        import_batch_id=batch.id if batch else None,
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
    version = AssetVersion(
        id=version_id,
        asset_id=asset_id,
        version_number=1,
        recipe={},
        status=VERSION_STATUS_UPLOADED,
        preview_status=TASK_STATUS_PENDING,
        faces_status=TASK_STATUS_PENDING,
        keywords=[],
        is_identity_source=False,
    )
    db.add(asset)
    db.add(file_record)
    db.add(version)
    db.commit()

    task = process_asset_preview.delay(str(version.id))
    return UploadResponseSchema(
        asset_id=asset_id,
        version_id=version.id,
        version_number=version.version_number,
        status=version.status,
        preview_status=version.preview_status,
        faces_status=version.faces_status,
        preview_error=version.preview_error,
        faces_error=version.faces_error,
        job_id=task.id,
        filename=filename,
    )


@router.get("", response_model=AssetListResponseSchema)
def list_assets(
    limit: int = 50,
    cursor: str | None = None,
    batch_id: uuid_mod.UUID | None = None,
    lifecycle: Literal["active", "trashed", "all"] = Query(default="active"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    limit = max(1, min(limit, 200))

    q = db.query(Asset).filter(Asset.owner_id == current_user.id)
    if lifecycle == "active":
        q = q.filter(Asset.lifecycle_status == ASSET_LIFECYCLE_ACTIVE)
    elif lifecycle == "trashed":
        q = q.filter(Asset.lifecycle_status == ASSET_LIFECYCLE_TRASHED)
    q = q.order_by(Asset.created_at.desc(), Asset.id.desc())
    if batch_id is not None:
        q = q.filter(Asset.import_batch_id == batch_id)

    if cursor:
        try:
            c_created_at, c_asset_id = _decode_cursor(cursor)
        except Exception:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Некорректный cursor",
            )

        q = q.filter(
            (Asset.created_at < c_created_at)
            | ((Asset.created_at == c_created_at) & (Asset.id < c_asset_id))
        )

    rows = q.limit(limit + 1).all()
    has_more = len(rows) > limit
    rows = rows[:limit]

    asset_ids = [asset.id for asset in rows]
    latest_versions = _get_latest_versions_map(db, asset_ids)
    version_files = _get_version_files_map(
        db,
        [version.id for version in latest_versions.values()],
    )

    items: list[AssetListItemSchema] = []
    for asset in rows:
        version = latest_versions.get(asset.id)
        items.append(
            AssetListItemSchema(
                asset_id=asset.id,
                title=asset.title,
                created_at=asset.created_at,
                updated_at=asset.updated_at,
                lifecycle_status=asset.lifecycle_status,
                trashed_at=asset.trashed_at,
                version=(
                    _build_version_summary(
                        version,
                        version_files.get(version.id, {}),
                    )
                    if version
                    else None
                ),
            )
        )

    next_cursor = None
    if has_more and rows:
        last_row = rows[-1]
        next_cursor = _encode_cursor(last_row.created_at, last_row.id)

    return AssetListResponseSchema(items=items, next_cursor=next_cursor)


@router.get("/files/{file_id}")
def get_asset_file(
    file_id: uuid_mod.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    row = (
        db.query(AssetFileModel, Asset)
        .join(Asset, Asset.id == AssetFileModel.asset_id)
        .filter(AssetFileModel.id == file_id)
        .first()
    )
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Файл не найден",
        )
    f, asset = row
    if asset.owner_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Файл не найден",
        )
    _require_active_lifecycle(asset)

    path = Path(settings.storage_root) / f.path
    if not path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Файл отсутствует на диске",
        )

    return FileResponse(path, media_type=f.mime_type, filename=f.filename)


@router.post("/{asset_id}/versions", response_model=AssetVersionJobResponseSchema)
def create_asset_version(
    asset_id: uuid_mod.UUID,
    body: AssetVersionCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    asset = _require_user_asset(db, asset_id, current_user)
    _require_active_lifecycle(asset)
    latest_version = _get_latest_version(db, asset_id)

    base_version = None
    if body.base_version_id is not None:
        base_version = (
            db.query(AssetVersion)
            .filter_by(id=body.base_version_id, asset_id=asset.id)
            .first()
        )
        if not base_version:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Базовая версия не найдена",
            )
    else:
        base_version = latest_version

    next_number = (latest_version.version_number + 1) if latest_version else 1
    version = AssetVersion(
        asset_id=asset.id,
        base_version_id=base_version.id if base_version else None,
        version_number=next_number,
        recipe=body.recipe.model_dump(mode="json"),
        status=VERSION_STATUS_UPLOADED,
        preview_status=TASK_STATUS_PENDING,
        faces_status=TASK_STATUS_PENDING,
        exif=base_version.exif if base_version else None,
        iptc=base_version.iptc if base_version else None,
        xmp=base_version.xmp if base_version else None,
        other=base_version.other if base_version else None,
        rating=base_version.rating if base_version else None,
        keywords=list(base_version.keywords or []) if base_version else [],
        is_identity_source=False,
    )
    db.add(version)
    db.commit()
    db.refresh(version)

    task = process_asset_preview.delay(str(version.id))
    return AssetVersionJobResponseSchema(
        asset_id=asset.id,
        version_id=version.id,
        version_number=version.version_number,
        status=version.status,
        preview_status=version.preview_status,
        faces_status=version.faces_status,
        preview_error=version.preview_error,
        faces_error=version.faces_error,
        job_id=task.id,
    )


@router.get("/{asset_id}/versions", response_model=AssetVersionHistoryResponseSchema)
def list_asset_versions(
    asset_id: uuid_mod.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    asset = _require_user_asset(db, asset_id, current_user)
    _require_active_lifecycle(asset)
    versions = (
        db.query(AssetVersion)
        .filter_by(asset_id=asset_id)
        .order_by(AssetVersion.version_number.desc())
        .all()
    )
    files_map = _get_version_files_map(db, [version.id for version in versions])
    return AssetVersionHistoryResponseSchema(
        items=[
            _build_version_summary(version, files_map.get(version.id, {}))
            for version in versions
        ]
    )


@router.get("/{asset_id}", response_model=AssetViewerResponseSchema)
def get_asset_viewer(
    asset_id: uuid_mod.UUID,
    version_id: uuid_mod.UUID | None = Query(default=None),
    version_number: int | None = Query(default=None, ge=1),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    asset = _require_user_asset(db, asset_id, current_user)
    _require_active_lifecycle(asset)
    version = _get_version_or_404(
        db,
        asset_id,
        version_id=version_id,
        version_number=version_number,
    )

    version_files = _get_version_files_map(db, [version.id]).get(version.id, {})
    original = _get_original_file(db, asset_id)

    detections = (
        db.query(FaceDetection)
        .options(
            joinedload(FaceDetection.identity).joinedload(FaceIdentity.person),
            joinedload(FaceDetection.candidates)
            .joinedload(FaceCandidate.identity)
            .joinedload(FaceIdentity.person),
        )
        .filter(FaceDetection.asset_version_id == version.id)
        .order_by(FaceDetection.created_at.asc())
        .all()
    )

    faces = []
    for det in detections:
        identity = det.identity
        person = identity.person if identity else None
        grouped_candidates: dict[
            uuid_mod.UUID,
            AssetViewerFacePersonCandidateSchema,
        ] = {}
        for candidate in det.candidates:
            candidate_identity = candidate.identity
            candidate_person = candidate_identity.person if candidate_identity else None
            if not candidate_person:
                continue

            person_id = candidate_person.id
            existing = grouped_candidates.get(person_id)
            if existing and existing.score >= candidate.score:
                continue

            grouped_candidates[person_id] = AssetViewerFacePersonCandidateSchema(
                person_id=person_id,
                person_name=candidate_person.name,
                best_identity_id=candidate.identity_id,
                rank=candidate.rank,
                score=candidate.score,
            )

        faces.append(
            AssetViewerFaceSchema(
                id=det.id,
                asset_version_id=det.asset_version_id,
                identity_id=identity.id if identity else None,
                person_id=person.id if person else None,
                person_name=person.name if person else None,
                bbox=det.bbox,
                confidence=det.confidence,
                quality_score=det.quality_score,
                is_reference=det.is_reference,
                assignment_source=det.assignment_source,
                review_required=det.review_required,
                review_state=det.review_state,
                candidates=sorted(
                    grouped_candidates.values(),
                    key=lambda item: item.score,
                    reverse=True,
                ),
            )
        )

    return AssetViewerResponseSchema(
        id=asset.id,
        title=asset.title,
        created_at=asset.created_at,
        updated_at=asset.updated_at,
        version=_build_version_summary(version, version_files),
        photo=_build_photo_info(version, original),
        faces=faces,
        faces_count=len(faces),
    )


@router.get("/{asset_id}/metadata", response_model=AssetMetadataResponseSchema)
def get_asset_metadata(
    asset_id: uuid_mod.UUID,
    version_id: uuid_mod.UUID | None = Query(default=None),
    version_number: int | None = Query(default=None, ge=1),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    asset = _require_user_asset(db, asset_id, current_user)
    _require_active_lifecycle(asset)
    version = _get_version_or_404(
        db,
        asset_id,
        version_id=version_id,
        version_number=version_number,
    )

    metadata = AssetMetadataSchema(
        version_id=version.id,
        version_number=version.version_number,
        base_version_id=version.base_version_id,
        status=version.status,
        preview_status=version.preview_status,
        faces_status=version.faces_status,
        preview_error=version.preview_error,
        faces_error=version.faces_error,
        recipe=normalize_recipe(version.recipe),
        exif=version.exif,
        iptc=version.iptc,
        xmp=version.xmp,
        other=version.other,
        rating=version.rating,
        keywords=_normalize_keywords(version.keywords),
        rendered_width=version.rendered_width,
        rendered_height=version.rendered_height,
        is_identity_source=version.is_identity_source,
        created_at=version.created_at,
    )

    return AssetMetadataResponseSchema(
        id=asset.id,
        title=asset.title,
        created_at=asset.created_at,
        updated_at=asset.updated_at,
        metadata=metadata,
    )


@router.get("/{asset_id}/status", response_model=AssetVersionStatusSchema)
def get_asset_status(
    asset_id: uuid_mod.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    asset = _require_user_asset(db, asset_id, current_user)
    _require_active_lifecycle(asset)
    version = _get_version_or_404(db, asset_id)
    return _build_version_status_schema(version)


@router.post(
    "/{asset_id}/versions/{version_id}/retry-preview",
    response_model=AssetVersionStatusSchema,
)
def retry_asset_preview(
    asset_id: uuid_mod.UUID,
    version_id: uuid_mod.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    asset = _require_user_asset(db, asset_id, current_user)
    _require_active_lifecycle(asset)
    version = _get_version_or_404(db, asset_id, version_id=version_id)

    if version.preview_status != TASK_STATUS_FAILED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Повторить preview можно только у версий с "
                f"preview_status='failed' (текущий: '{version.preview_status}')"
            ),
        )

    original_file = _get_original_file(db, asset_id)
    if not original_file:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Невозможно повторить preview: не найден оригинальный файл",
        )

    version.preview_status = TASK_STATUS_PENDING
    version.preview_error = None
    version.faces_status = TASK_STATUS_PENDING
    version.faces_error = None
    apply_version_status(version)
    db.commit()

    process_asset_preview.delay(str(version.id))
    return _build_version_status_schema(version)


@router.post(
    "/{asset_id}/versions/{version_id}/retry-faces",
    response_model=AssetVersionStatusSchema,
)
def retry_asset_faces(
    asset_id: uuid_mod.UUID,
    version_id: uuid_mod.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    asset = _require_user_asset(db, asset_id, current_user)
    _require_active_lifecycle(asset)
    version = _get_version_or_404(db, asset_id, version_id=version_id)

    if version.faces_status != TASK_STATUS_FAILED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Повторить faces можно только у версий с "
                f"faces_status='failed' (текущий: '{version.faces_status}')"
            ),
        )
    if version.preview_status != TASK_STATUS_COMPLETED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Нельзя запускать faces без успешного preview",
        )

    if asset.import_batch_id is not None:
        batch = db.query(ImportBatch).filter_by(id=asset.import_batch_id).first()
        if batch and batch.status == IMPORT_BATCH_STATUS_PENDING_REVIEW:
            batch.status = IMPORT_BATCH_STATUS_PROCESSING
            db.add(batch)

    version.faces_status = TASK_STATUS_PENDING
    version.faces_error = None
    apply_version_status(version)
    db.commit()

    process_asset_ml.delay(str(version.id))
    return _build_version_status_schema(version)


@router.post("/{asset_id}/trash", response_model=AssetLifecycleResponseSchema)
def trash_asset(
    asset_id: uuid_mod.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    asset = _require_user_asset(db, asset_id, current_user)
    _require_active_lifecycle(asset)
    asset.lifecycle_status = ASSET_LIFECYCLE_TRASHED
    asset.trashed_at = datetime.utcnow()
    asset.trashed_by_user_id = current_user.id
    db.commit()
    db.refresh(asset)
    return AssetLifecycleResponseSchema(
        asset_id=asset.id,
        lifecycle_status=asset.lifecycle_status,
        trashed_at=asset.trashed_at,
    )


@router.delete("/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
def permanently_delete_asset(
    asset_id: uuid_mod.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    asset = _require_user_asset(db, asset_id, current_user)
    _require_trashed_lifecycle(asset)
    paths = _collect_asset_relative_paths(db, asset.id)
    db.delete(asset)
    db.commit()
    _unlink_asset_rel_paths(paths)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
