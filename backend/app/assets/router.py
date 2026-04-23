import uuid as uuid_mod
import shutil
import base64
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, Form, UploadFile, HTTPException, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import select

from app.database import get_db
from app.users.dependencies import get_current_user
from app.users.models import User
from app.config import settings
from app.assets.models import (
    ASSET_STATUS_ERROR,
    ASSET_STATUS_UPLOADED,
    TASK_STATUS_COMPLETED,
    TASK_STATUS_FAILED,
    TASK_STATUS_PENDING,
    apply_asset_status,
    Asset,
    AssetVersion,
    File as AssetFileModel,
)
from app.assets.schemas import (
    UploadResponseSchema,
    AssetStatusSchema,
    AssetListItemSchema,
    AssetListResponseSchema,
    AssetViewerResponseSchema,
    AssetViewerFacePersonCandidateSchema,
    AssetViewerFaceSchema,
    AssetPhotoInfoSchema,
    AssetMetadataSchema,
    AssetMetadataResponseSchema,
)
from app.faces.models import FaceCandidate, FaceDetection, FaceIdentity
from app.import_batches.models import (
    IMPORT_BATCH_STATUS_PENDING_REVIEW,
    IMPORT_BATCH_STATUS_PROCESSING,
    IMPORT_BATCH_STATUS_UPLOADING,
    ImportBatch,
)
from app.assets.tasks import process_asset_ml, process_asset_preview

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


def _get_asset_or_404(db: Session, asset_id: uuid_mod.UUID) -> Asset:
    asset = db.query(Asset).filter_by(id=asset_id).first()
    if not asset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Ассет не найден",
        )
    return asset


def _get_latest_file(
    db: Session,
    asset_id: uuid_mod.UUID,
    purpose: str,
) -> AssetFileModel | None:
    return (
        db.query(AssetFileModel)
        .filter_by(asset_id=asset_id, purpose=purpose)
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


def _normalize_keywords(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(x) for x in value]
    return []


def _deep_get(data: dict[str, Any] | None, *paths: str) -> Any | None:
    """
    Пример:
    _deep_get(exif, "DateTimeOriginal", "EXIF.DateTimeOriginal", "IFD0.Model")
    """
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
        width=_deep_get(
            exif,
            "ImageWidth",
            "EXIF.ExifImageWidth",
            "Composite.ImageWidth",
        ) or _deep_get(other, "width"),
        height=_deep_get(
            exif,
            "ImageHeight",
            "EXIF.ExifImageHeight",
            "Composite.ImageHeight",
        ) or _deep_get(other, "height"),
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
        status=ASSET_STATUS_UPLOADED,
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
    db.add(asset)
    db.add(file_record)
    db.commit()

    task = process_asset_preview.delay(str(asset_id), str(file_id))

    return UploadResponseSchema(
        asset_id=asset_id,
        job_id=task.id,
        filename=filename,
        status=ASSET_STATUS_UPLOADED,
    )


@router.get("", response_model=AssetListResponseSchema)
def list_assets(
    limit: int = 50,
    cursor: str | None = None,
    batch_id: uuid_mod.UUID | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    limit = max(1, min(limit, 200))

    thumb_id_sq = (
        select(AssetFileModel.id)
        .where(
            AssetFileModel.asset_id == Asset.id,
            AssetFileModel.purpose == "thumbnail",
        )
        .order_by(AssetFileModel.created_at.desc())
        .limit(1)
        .correlate(Asset)
        .scalar_subquery()
    )

    preview_id_sq = (
        select(AssetFileModel.id)
        .where(
            AssetFileModel.asset_id == Asset.id,
            AssetFileModel.purpose == "preview",
        )
        .order_by(AssetFileModel.created_at.desc())
        .limit(1)
        .correlate(Asset)
        .scalar_subquery()
    )

    q = db.query(
        Asset.id.label("asset_id"),
        Asset.title,
        Asset.status,
        Asset.preview_status,
        Asset.faces_status,
        Asset.created_at,
        thumb_id_sq.label("thumb_id"),
        preview_id_sq.label("preview_id"),
    ).order_by(Asset.created_at.desc(), Asset.id.desc())

    if batch_id is not None:
        # Внутри партии показываем всё, включая импортируемые и ошибки:
        # это контент ревью, пользователю важно увидеть любые проблемы.
        q = q.filter(Asset.import_batch_id == batch_id)
    else:
        q = q.filter(Asset.status != ASSET_STATUS_ERROR)

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

    items: list[AssetListItemSchema] = []
    for row in rows:
        items.append(
            AssetListItemSchema(
                asset_id=row.asset_id,
                title=row.title,
                status=row.status,
                preview_status=row.preview_status,
                faces_status=row.faces_status,
                created_at=row.created_at,
                thumbnail_file_id=row.thumb_id,
                thumbnail_url=_build_file_url(row.thumb_id),
                preview_file_id=row.preview_id,
                preview_url=_build_file_url(row.preview_id),
            )
        )

    next_cursor = None
    if has_more and rows:
        last_row = rows[-1]
        next_cursor = _encode_cursor(last_row.created_at, last_row.asset_id)

    return AssetListResponseSchema(
        items=items,
        next_cursor=next_cursor,
    )


@router.get("/files/{file_id}")
def get_asset_file(
    file_id: uuid_mod.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    f = db.query(AssetFileModel).filter_by(id=file_id).first()
    if not f:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Файл не найден",
        )

    path = Path(settings.storage_root) / f.path
    if not path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Файл отсутствует на диске",
        )

    return FileResponse(path, media_type=f.mime_type, filename=f.filename)


@router.get("/{asset_id}", response_model=AssetViewerResponseSchema)
def get_asset_viewer(
    asset_id: uuid_mod.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    asset = _get_asset_or_404(db, asset_id)

    preview = _get_latest_file(db, asset_id, "preview")
    original = _get_latest_file(db, asset_id, "original")
    version = _get_latest_version(db, asset_id)

    detections = (
        db.query(FaceDetection)
        .options(
            joinedload(FaceDetection.identity)
            .joinedload(FaceIdentity.person),
            joinedload(FaceDetection.candidates)
            .joinedload(FaceCandidate.identity)
            .joinedload(FaceIdentity.person),
        )
        .filter(FaceDetection.asset_id == asset_id)
        .order_by(FaceDetection.created_at.asc())
        .all()
    )

    faces = []
    for det in detections:
        identity = det.identity
        person = identity.person if identity else None
        grouped_candidates: dict[uuid_mod.UUID, AssetViewerFacePersonCandidateSchema] = {}
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

        person_candidates = sorted(
            grouped_candidates.values(),
            key=lambda item: item.score,
            reverse=True,
        )
        faces.append(AssetViewerFaceSchema(
            id=det.id,
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
            candidates=person_candidates,
        ))

    return AssetViewerResponseSchema(
        id=asset.id,
        title=asset.title,
        status=asset.status,
        preview_status=asset.preview_status,
        faces_status=asset.faces_status,
        preview_error=asset.preview_error,
        faces_error=asset.faces_error,
        created_at=asset.created_at,
        updated_at=asset.updated_at,
        preview_file_id=preview.id if preview else None,
        preview_url=_build_file_url(preview.id if preview else None),
        photo=_build_photo_info(version, original),
        faces=faces,
        faces_count=len(faces),
    )


@router.get("/{asset_id}/metadata", response_model=AssetMetadataResponseSchema)
def get_asset_metadata(
    asset_id: uuid_mod.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    asset = _get_asset_or_404(db, asset_id)
    version = _get_latest_version(db, asset_id)

    metadata = None
    if version:
        metadata = AssetMetadataSchema(
            version_id=version.id,
            version_number=version.version_number,
            exif=version.exif,
            iptc=version.iptc,
            xmp=version.xmp,
            other=version.other,
            rating=version.rating,
            keywords=_normalize_keywords(version.keywords),
            created_at=version.created_at,
        )

    return AssetMetadataResponseSchema(
        id=asset.id,
        title=asset.title,
        status=asset.status,
        created_at=asset.created_at,
        updated_at=asset.updated_at,
        metadata=metadata,
    )


def _build_asset_status_schema(asset: Asset) -> AssetStatusSchema:
    return AssetStatusSchema(
        asset_id=asset.id,
        status=asset.status,
        preview_status=asset.preview_status,
        faces_status=asset.faces_status,
        preview_error=asset.preview_error,
        faces_error=asset.faces_error,
    )


@router.get("/{asset_id}/status", response_model=AssetStatusSchema)
def get_asset_status(
    asset_id: uuid_mod.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    asset = _get_asset_or_404(db, asset_id)

    return _build_asset_status_schema(asset)


@router.post("/{asset_id}/retry-preview", response_model=AssetStatusSchema)
def retry_asset_preview(
    asset_id: uuid_mod.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    asset = _get_asset_or_404(db, asset_id)

    if asset.preview_status != TASK_STATUS_FAILED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Повторить preview можно только у ассетов с "
                f"preview_status='failed' (текущий: '{asset.preview_status}')"
            ),
        )

    original_file = _get_latest_file(db, asset.id, "original")
    if not original_file:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Невозможно повторить preview: не найден оригинальный файл",
        )

    asset.preview_status = TASK_STATUS_PENDING
    asset.preview_error = None
    apply_asset_status(asset)
    db.commit()

    process_asset_preview.delay(str(asset.id), str(original_file.id))
    return _build_asset_status_schema(asset)


@router.post("/{asset_id}/retry-faces", response_model=AssetStatusSchema)
def retry_asset_faces(
    asset_id: uuid_mod.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    asset = _get_asset_or_404(db, asset_id)

    if asset.faces_status != TASK_STATUS_FAILED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Повторить faces можно только у ассетов с "
                f"faces_status='failed' (текущий: '{asset.faces_status}')"
            ),
        )
    if asset.preview_status != TASK_STATUS_COMPLETED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Нельзя запускать faces без успешного preview",
        )

    # Если партия уже ушла в pending_review, возвращаем её в processing —
    # иначе _finalize_batch_if_done после нашего retry ничего не сделает и
    # батч так и останется в pending_review с незаконченным ассетом.
    if asset.import_batch_id is not None:
        batch = db.query(ImportBatch).filter_by(id=asset.import_batch_id).first()
        if batch and batch.status == IMPORT_BATCH_STATUS_PENDING_REVIEW:
            batch.status = IMPORT_BATCH_STATUS_PROCESSING
            db.add(batch)

    asset.faces_status = TASK_STATUS_PENDING
    asset.faces_error = None
    apply_asset_status(asset)
    db.commit()

    process_asset_ml.delay(str(asset.id))
    return _build_asset_status_schema(asset)