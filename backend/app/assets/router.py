import base64
import re
import shutil
import uuid as uuid_mod
from datetime import date, datetime
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, Depends, Form, HTTPException, Query, Response, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import and_, func
from sqlalchemy.orm import Session, joinedload

from app.assets.models import (
    ASSET_LIFECYCLE_ACTIVE,
    ASSET_LIFECYCLE_TRASHED,
    TASK_STATUS_COMPLETED,
    TASK_STATUS_FAILED,
    TASK_STATUS_PENDING,
    VERSION_STATUS_UPLOADED,
    Asset,
    AssetDuplicateCandidate,
    AssetVersion,
    File as AssetFileModel,
    apply_version_status,
)
from app.assets.image_formats import resolve_upload_mime
from app.assets.lifecycle import (
    collect_asset_relative_paths,
    hard_delete_asset,
    prepare_asset_hard_delete,
    unlink_asset_rel_paths,
)
from app.assets.recipes import normalize_recipe
from app.assets.schemas import (
    AssetLifecycleResponseSchema,
    AssetListItemSchema,
    AssetListResponseSchema,
    AssetTagsListResponseSchema,
    AssetMetadataResponseSchema,
    AssetMetadataSchema,
    AssetPhotoInfoSchema,
    AssetVersionCreateRequest,
    AssetVersionHistoryResponseSchema,
    AssetVersionJobResponseSchema,
    AssetVersionStatusSchema,
    AssetVersionSummarySchema,
    AssetVersionTagsResponseSchema,
    AssetVersionTagsUpdateRequest,
    AssetViewerFacePersonCandidateSchema,
    AssetViewerFaceSchema,
    AssetViewerResponseSchema,
    UploadResponseSchema,
)
from app.assets.metadata_display import extract_photo_display_fields
from app.assets.metadata_filters import apply_metadata_filters, collect_distinct_tags
from app.assets.person_filters import apply_person_filter
from app.assets.ml_service import embed_text
from app.assets.tasks import process_asset_ml, process_asset_preview
from app.config import settings
from app.database import get_db
from app.faces.models import FaceCandidate, FaceDetection, FaceIdentity
from app.folders.models import Folder, FolderAsset
from app.folders.schemas import AssetFoldersResponseSchema, AssetFoldersUpdateRequest
from app.folders.service import (
    build_folder_summary,
    list_asset_folders,
    require_folder,
    require_asset as require_folder_asset,
)
from app.import_batches.models import (
    IMPORT_BATCH_STATUS_PENDING_REVIEW,
    IMPORT_BATCH_STATUS_PROCESSING,
    IMPORT_BATCH_STATUS_UPLOADING,
    ImportBatch,
)
from app.users.dependencies import get_current_user
from app.users.models import User

router = APIRouter(prefix="/api/v1/assets", tags=["assets"])

MAX_VERSION_TAGS = 30
MAX_TAG_LENGTH = 64
SPACE_RE = re.compile(r"\s+")


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


def _require_asset(db: Session, asset_id: uuid_mod.UUID) -> Asset:
    asset = db.query(Asset).filter(Asset.id == asset_id).first()
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


def _require_readable_lifecycle(asset: Asset) -> None:
    if asset.lifecycle_status not in (
        ASSET_LIFECYCLE_ACTIVE,
        ASSET_LIFECYCLE_TRASHED,
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Операция недоступна для текущего состояния ассета",
        )


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


def _get_unassigned_faces_count_map(
    db: Session,
    asset_ids: list[uuid_mod.UUID],
) -> dict[uuid_mod.UUID, int]:
    if not asset_ids:
        return {}

    rows = (
        db.query(
            FaceDetection.asset_id,
            func.count(FaceDetection.id),
        )
        .filter(
            FaceDetection.asset_id.in_(asset_ids),
            FaceDetection.review_required.is_(True),
            FaceDetection.identity_id.is_(None),
        )
        .group_by(FaceDetection.asset_id)
        .all()
    )
    return {asset_id: int(count) for asset_id, count in rows}


def _normalize_tag(value: str) -> str | None:
    tag = SPACE_RE.sub(" ", value.strip())
    if not tag:
        return None
    if len(tag) > MAX_TAG_LENGTH:
        tag = tag[:MAX_TAG_LENGTH].rstrip()
    return tag or None


def _normalize_keywords(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []

    out: list[str] = []
    seen: set[str] = set()
    for item in value[:MAX_VERSION_TAGS]:
        tag = _normalize_tag(str(item))
        if tag is None:
            continue
        key = tag.casefold()
        if key in seen:
            continue
        seen.add(key)
        out.append(tag)
    return out


def _parse_tags_csv(value: str | None) -> list[str]:
    if not value:
        return []
    tags: list[str] = []
    seen: set[str] = set()
    for part in value.split(","):
        tag = _normalize_tag(part)
        if tag is None:
            continue
        key = tag.casefold()
        if key in seen:
            continue
        seen.add(key)
        tags.append(tag)
    return tags


def _build_scoped_assets_query(
    db: Session,
    *,
    lifecycle: Literal["active", "trashed", "all"],
    batch_id: uuid_mod.UUID | None,
    folder_id: uuid_mod.UUID | None,
    current_user: User,
):
    q = db.query(Asset)
    if lifecycle == "active":
        q = q.filter(Asset.lifecycle_status == ASSET_LIFECYCLE_ACTIVE)
    elif lifecycle == "trashed":
        q = q.filter(Asset.lifecycle_status == ASSET_LIFECYCLE_TRASHED)
    if batch_id is not None:
        q = q.filter(Asset.import_batch_id == batch_id)
    if folder_id is not None:
        require_folder(db, folder_id, current_user)
        q = q.join(FolderAsset, FolderAsset.asset_id == Asset.id).filter(
            FolderAsset.folder_id == folder_id,
        )
    return q


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
        keywords=_normalize_keywords(version.keywords),
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
    display = extract_photo_display_fields(
        exif=version.exif if version else None,
        other=version.other if version else None,
        xmp=version.xmp if version else None,
        rendered_width=version.rendered_width if version else None,
        rendered_height=version.rendered_height if version else None,
    )

    return AssetPhotoInfoSchema(
        original_file_id=original_file.id if original_file else None,
        original_url=_build_file_url(original_file.id if original_file else None),
        filename=original_file.filename if original_file else None,
        mime_type=original_file.mime_type if original_file else None,
        size_bytes=original_file.size_bytes if original_file else None,
        width=display["width"],
        height=display["height"],
        taken_at=display["taken_at"],
        camera_make=display["camera_make"],
        camera_model=display["camera_model"],
        lens=display["lens"],
        iso=display["iso"],
        aperture=display["aperture"],
        shutter_speed=display["shutter_speed"],
        focal_length=display["focal_length"],
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
    resolved_mime = resolve_upload_mime(content_type, file.filename)
    if resolved_mime is None:
        ext_hint = Path(file.filename or "").suffix.lower() or "без расширения"
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=(
                "Неподдерживаемый формат: "
                f"{content_type or 'неизвестный MIME'} ({ext_hint})"
            ),
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
        mime_type=resolved_mime,
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
    folder_id: uuid_mod.UUID | None = None,
    lifecycle: Literal["active", "trashed", "all"] = Query(default="active"),
    tags: str | None = None,
    taken_from: date | None = None,
    taken_to: date | None = None,
    camera: str | None = None,
    person_id: uuid_mod.UUID | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    limit = max(1, min(limit, 200))
    parsed_tags = _parse_tags_csv(tags)
    camera_value = camera.strip() if camera else None

    q = _build_scoped_assets_query(
        db,
        lifecycle=lifecycle,
        batch_id=batch_id,
        folder_id=folder_id,
        current_user=current_user,
    )
    q = apply_metadata_filters(
        db,
        q,
        tags=parsed_tags or None,
        taken_from=taken_from,
        taken_to=taken_to,
        camera=camera_value,
    )
    if person_id is not None:
        q = apply_person_filter(q, db, person_id=person_id)
    sort_timestamp = (
        func.coalesce(Asset.trashed_at, Asset.created_at)
        if lifecycle == "trashed"
        else Asset.created_at
    )
    q = q.order_by(sort_timestamp.desc(), Asset.id.desc())

    if cursor:
        try:
            c_created_at, c_asset_id = _decode_cursor(cursor)
        except Exception:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Некорректный cursor",
            )

        q = q.filter(
            (sort_timestamp < c_created_at)
            | ((sort_timestamp == c_created_at) & (Asset.id < c_asset_id))
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
    unassigned_faces_counts = _get_unassigned_faces_count_map(db, asset_ids)

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
                import_batch_id=asset.import_batch_id,
                duplicate_review_status=asset.duplicate_review_status,
                duplicate_of_asset_id=asset.duplicate_of_asset_id,
                unassigned_faces_count=unassigned_faces_counts.get(asset.id, 0),
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
        cursor_timestamp = (
            last_row.trashed_at or last_row.created_at
            if lifecycle == "trashed"
            else last_row.created_at
        )
        next_cursor = _encode_cursor(cursor_timestamp, last_row.id)

    return AssetListResponseSchema(items=items, next_cursor=next_cursor)


@router.get("/tags", response_model=AssetTagsListResponseSchema)
def list_asset_tags(
    q: str | None = None,
    limit: int = 20,
    folder_id: uuid_mod.UUID | None = None,
    lifecycle: Literal["active", "trashed", "all"] = Query(default="active"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    limit = max(1, min(limit, 100))
    asset_query = _build_scoped_assets_query(
        db,
        lifecycle=lifecycle,
        batch_id=None,
        folder_id=folder_id,
        current_user=current_user,
    )
    tags = collect_distinct_tags(
        db,
        asset_query=asset_query,
        prefix=q,
        limit=limit,
    )
    return AssetTagsListResponseSchema(items=tags)


@router.get("/search/semantic", response_model=AssetListResponseSchema)
def search_assets_semantic(
    q: str = Query(..., min_length=1),
    limit: int = 50,
    max_distance: float = Query(default=0.85, ge=0.0, le=2.0),
    folder_id: uuid_mod.UUID | None = None,
    lifecycle: Literal["active", "trashed", "all"] = Query(default="active"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = q.strip()
    if not query:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Пустой поисковый запрос",
        )

    limit = max(1, min(limit, 100))
    try:
        query_embedding = embed_text(query)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    latest_sq = (
        db.query(
            AssetVersion.asset_id.label("asset_id"),
            func.max(AssetVersion.version_number).label("max_version_number"),
        )
        .join(Asset, AssetVersion.asset_id == Asset.id)
        .group_by(AssetVersion.asset_id)
        .subquery()
    )
    distance = AssetVersion.semantic_embedding.cosine_distance(query_embedding)
    print(distance)
    rows = (
        db.query(Asset, AssetVersion)
        .join(AssetVersion, AssetVersion.asset_id == Asset.id)
        .join(
            latest_sq,
            and_(
                AssetVersion.asset_id == latest_sq.c.asset_id,
                AssetVersion.version_number == latest_sq.c.max_version_number,
            ),
        )
        .filter(AssetVersion.semantic_embedding.isnot(None))
        .filter(distance <= max_distance)
    )
    if lifecycle == "active":
        rows = rows.filter(Asset.lifecycle_status == ASSET_LIFECYCLE_ACTIVE)
    elif lifecycle == "trashed":
        rows = rows.filter(Asset.lifecycle_status == ASSET_LIFECYCLE_TRASHED)
    if folder_id is not None:
        require_folder(db, folder_id, current_user)
        rows = rows.join(FolderAsset, FolderAsset.asset_id == Asset.id).filter(
            FolderAsset.folder_id == folder_id,
        )

    rows = rows.order_by(distance.asc(), Asset.created_at.desc()).limit(limit).all()
    versions = [version for _, version in rows]
    version_files = _get_version_files_map(db, [version.id for version in versions])
    unassigned_faces_counts = _get_unassigned_faces_count_map(
        db,
        [asset.id for asset, _ in rows],
    )

    items = [
        AssetListItemSchema(
            asset_id=asset.id,
            title=asset.title,
            created_at=asset.created_at,
            updated_at=asset.updated_at,
            lifecycle_status=asset.lifecycle_status,
            trashed_at=asset.trashed_at,
            import_batch_id=asset.import_batch_id,
            duplicate_review_status=asset.duplicate_review_status,
            duplicate_of_asset_id=asset.duplicate_of_asset_id,
            unassigned_faces_count=unassigned_faces_counts.get(asset.id, 0),
            version=_build_version_summary(
                version,
                version_files.get(version.id, {}),
            ),
        )
        for asset, version in rows
    ]

    return AssetListResponseSchema(items=items, next_cursor=None)


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
    _require_readable_lifecycle(asset)

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
    asset = _require_asset(db, asset_id)
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
        keywords=_normalize_keywords(base_version.keywords) if base_version else [],
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
    asset = _require_asset(db, asset_id)
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


@router.put(
    "/{asset_id}/versions/{version_id}/tags",
    response_model=AssetVersionTagsResponseSchema,
)
def update_asset_version_tags(
    asset_id: uuid_mod.UUID,
    version_id: uuid_mod.UUID,
    body: AssetVersionTagsUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    asset = _require_asset(db, asset_id)
    _require_active_lifecycle(asset)
    version = _get_version_or_404(db, asset_id, version_id=version_id)

    keywords = _normalize_keywords(body.tags)
    version.keywords = keywords
    db.commit()
    db.refresh(version)

    return AssetVersionTagsResponseSchema(
        asset_id=asset.id,
        version_id=version.id,
        version_number=version.version_number,
        keywords=keywords,
    )


@router.get("/{asset_id}", response_model=AssetViewerResponseSchema)
def get_asset_viewer(
    asset_id: uuid_mod.UUID,
    version_id: uuid_mod.UUID | None = Query(default=None),
    version_number: int | None = Query(default=None, ge=1),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    asset = _require_asset(db, asset_id)
    _require_readable_lifecycle(asset)
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
        lifecycle_status=asset.lifecycle_status,
        trashed_at=asset.trashed_at,
        version=_build_version_summary(version, version_files),
        photo=_build_photo_info(version, original),
        faces=faces,
        faces_count=len(faces),
        import_batch_id=asset.import_batch_id,
        duplicate_review_status=asset.duplicate_review_status,
        duplicate_of_asset_id=asset.duplicate_of_asset_id,
    )


@router.get("/{asset_id}/metadata", response_model=AssetMetadataResponseSchema)
def get_asset_metadata(
    asset_id: uuid_mod.UUID,
    version_id: uuid_mod.UUID | None = Query(default=None),
    version_number: int | None = Query(default=None, ge=1),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    asset = _require_asset(db, asset_id)
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
    asset = _require_asset(db, asset_id)
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
    asset = _require_asset(db, asset_id)
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
    asset = _require_asset(db, asset_id)
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
    asset = _require_asset(db, asset_id)
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


@router.post("/{asset_id}/restore", response_model=AssetLifecycleResponseSchema)
def restore_asset(
    asset_id: uuid_mod.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    asset = _require_asset(db, asset_id)
    _require_trashed_lifecycle(asset)
    asset.lifecycle_status = ASSET_LIFECYCLE_ACTIVE
    asset.trashed_at = None
    asset.trashed_by_user_id = None
    db.commit()
    db.refresh(asset)
    return AssetLifecycleResponseSchema(
        asset_id=asset.id,
        lifecycle_status=asset.lifecycle_status,
        trashed_at=asset.trashed_at,
    )


@router.get("/{asset_id}/folders", response_model=AssetFoldersResponseSchema)
def get_asset_folders(
    asset_id: uuid_mod.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    folders = list_asset_folders(db, asset_id, current_user)
    return AssetFoldersResponseSchema(asset_id=asset_id, folders=folders)


@router.put("/{asset_id}/folders", response_model=AssetFoldersResponseSchema)
def set_asset_folders(
    asset_id: uuid_mod.UUID,
    body: AssetFoldersUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    asset = require_folder_asset(db, asset_id)
    _require_active_lifecycle(asset)

    unique_folder_ids = list(dict.fromkeys(body.folder_ids))
    if unique_folder_ids:
        owned_count = (
            db.query(Folder)
            .filter(
                Folder.owner_id == current_user.id,
                Folder.id.in_(unique_folder_ids),
            )
            .count()
        )
        if owned_count != len(unique_folder_ids):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Одна или несколько папок не найдены",
            )

    db.query(FolderAsset).filter(FolderAsset.asset_id == asset_id).delete(
        synchronize_session=False,
    )
    for folder_id in unique_folder_ids:
        db.add(FolderAsset(folder_id=folder_id, asset_id=asset_id))
    db.commit()
    folders = list_asset_folders(db, asset_id, current_user)
    return AssetFoldersResponseSchema(asset_id=asset_id, folders=folders)


@router.post(
    "/{asset_id}/folders/{folder_id}",
    response_model=AssetFoldersResponseSchema,
    status_code=status.HTTP_200_OK,
)
def add_asset_to_folder(
    asset_id: uuid_mod.UUID,
    folder_id: uuid_mod.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    asset = require_folder_asset(db, asset_id)
    _require_active_lifecycle(asset)
    require_folder(db, folder_id, current_user)

    existing = (
        db.query(FolderAsset)
        .filter(
            FolderAsset.asset_id == asset_id,
            FolderAsset.folder_id == folder_id,
        )
        .first()
    )
    if not existing:
        db.add(FolderAsset(folder_id=folder_id, asset_id=asset_id))
        db.commit()

    folders = list_asset_folders(db, asset_id, current_user)
    return AssetFoldersResponseSchema(asset_id=asset_id, folders=folders)


@router.delete(
    "/{asset_id}/folders/{folder_id}",
    response_model=AssetFoldersResponseSchema,
)
def remove_asset_from_folder(
    asset_id: uuid_mod.UUID,
    folder_id: uuid_mod.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_folder_asset(db, asset_id)
    require_folder(db, folder_id, current_user)

    db.query(FolderAsset).filter(
        FolderAsset.asset_id == asset_id,
        FolderAsset.folder_id == folder_id,
    ).delete(synchronize_session=False)
    db.commit()

    folders = list_asset_folders(db, asset_id, current_user)
    return AssetFoldersResponseSchema(asset_id=asset_id, folders=folders)


@router.delete("/trash", status_code=status.HTTP_204_NO_CONTENT)
def empty_trash(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    assets = (
        db.query(Asset)
        .filter(
            Asset.owner_id == current_user.id,
            Asset.lifecycle_status == ASSET_LIFECYCLE_TRASHED,
        )
        .all()
    )
    paths: list[str] = []
    for asset in assets:
        paths.extend(collect_asset_relative_paths(db, asset.id))
        prepare_asset_hard_delete(db, asset.id)
        db.delete(asset)
    db.commit()
    unlink_asset_rel_paths(paths)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
def permanently_delete_asset(
    asset_id: uuid_mod.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    asset = _require_asset(db, asset_id)
    _require_trashed_lifecycle(asset)
    paths = collect_asset_relative_paths(db, asset.id)
    prepare_asset_hard_delete(db, asset.id)
    db.delete(asset)
    db.commit()
    unlink_asset_rel_paths(paths)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
