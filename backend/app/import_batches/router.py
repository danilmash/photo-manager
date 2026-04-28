import uuid as uuid_mod

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app.assets.models import (
    TASK_STATUS_COMPLETED,
    TASK_STATUS_FAILED,
    TASK_STATUS_PENDING,
    TASK_STATUS_PROCESSING,
    Asset,
    AssetVersion,
    File as AssetFileModel,
    apply_version_status,
)
from app.faces.models import FaceDetection
from app.assets.tasks import process_asset_ml, process_asset_preview
from app.database import get_db
from app.import_batches.models import (
    IMPORT_BATCH_STATUS_PENDING_REVIEW,
    IMPORT_BATCH_STATUS_PROCESSING,
    IMPORT_BATCH_STATUS_UPLOADING,
    ImportBatch,
)
from app.import_batches.schemas import (
    ImportBatchCreateRequest,
    ImportBatchReviewAssetItemSchema,
    ImportBatchReviewAssetsResponseSchema,
    ImportBatchRetrySummarySchema,
    ImportBatchSchema,
    ImportBatchSetProjectRequest,
)
from app.projects.models import Project
from app.users.dependencies import get_current_user
from app.users.models import User

router = APIRouter(prefix="/api/v1/import-batches", tags=["import-batches"])


def _latest_versions_sq(db: Session, batch_id):
    """Одна строка на ассет: максимальный version_number среди версий партии."""
    return (
        db.query(
            AssetVersion.asset_id.label("asset_id"),
            func.max(AssetVersion.version_number).label("max_version_number"),
        )
        .join(Asset, AssetVersion.asset_id == Asset.id)
        .filter(Asset.import_batch_id == batch_id)
        .group_by(AssetVersion.asset_id)
        .subquery()
    )


def _assets_count_subquery():
    return (
        select(func.count(Asset.id))
        .where(Asset.import_batch_id == ImportBatch.id)
        .correlate(ImportBatch)
        .scalar_subquery()
    )


def _to_schema(batch: ImportBatch, assets_count: int) -> ImportBatchSchema:
    return ImportBatchSchema(
        id=batch.id,
        project_id=batch.project_id,
        status=batch.status,
        note=batch.note,
        assets_count=assets_count,
        created_at=batch.created_at,
        updated_at=batch.updated_at,
    )


def _build_file_url(file_id: uuid_mod.UUID | None) -> str | None:
    if not file_id:
        return None
    return f"/api/v1/assets/files/{file_id}"


@router.post(
    "",
    response_model=ImportBatchSchema,
    status_code=status.HTTP_201_CREATED,
)
def create_import_batch(
    body: ImportBatchCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    batch = ImportBatch(
        project_id=None,
        status=IMPORT_BATCH_STATUS_UPLOADING,
        note=body.note,
    )
    db.add(batch)
    db.commit()
    db.refresh(batch)

    return _to_schema(batch, assets_count=0)


@router.get("", response_model=list[ImportBatchSchema])
def list_import_batches(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    status_filter: str | None = Query(default=None, alias="status"),
    project_id: uuid_mod.UUID | None = Query(default=None),
    in_main_library: bool | None = Query(
        default=None,
        description="true — только основная библиотека (project_id IS NULL)",
    ),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    assets_count_sq = _assets_count_subquery()

    query = (
        db.query(ImportBatch, assets_count_sq.label("assets_count"))
        .order_by(ImportBatch.created_at.desc())
    )

    if status_filter:
        query = query.filter(ImportBatch.status == status_filter)

    if in_main_library is True:
        query = query.filter(ImportBatch.project_id.is_(None))
    elif project_id is not None:
        query = query.filter(ImportBatch.project_id == project_id)

    rows = query.limit(limit).offset(offset).all()

    return [_to_schema(batch, count or 0) for batch, count in rows]


@router.get("/{batch_id}", response_model=ImportBatchSchema)
def get_import_batch(
    batch_id: uuid_mod.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    assets_count_sq = _assets_count_subquery()

    row = (
        db.query(ImportBatch, assets_count_sq.label("assets_count"))
        .filter(ImportBatch.id == batch_id)
        .first()
    )
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Партия импорта не найдена",
        )

    batch, count = row
    return _to_schema(batch, count or 0)


@router.get(
    "/{batch_id}/review-assets",
    response_model=ImportBatchReviewAssetsResponseSchema,
)
def list_import_batch_review_assets(
    batch_id: uuid_mod.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    batch = db.query(ImportBatch).filter_by(id=batch_id).first()
    if not batch:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Партия импорта не найдена",
        )

    review_faces_count_sq = (
        select(func.count(FaceDetection.id))
        .where(
            FaceDetection.asset_id == Asset.id,
            FaceDetection.review_required.is_(True),
        )
        .correlate(Asset)
        .scalar_subquery()
    )
    latest_sq = _latest_versions_sq(db, batch.id)
    preview_file_id_sq = (
        select(AssetFileModel.id)
        .where(
            AssetFileModel.asset_version_id == AssetVersion.id,
            AssetFileModel.purpose == "preview",
        )
        .order_by(AssetFileModel.created_at.desc())
        .limit(1)
        .correlate(AssetVersion)
        .scalar_subquery()
    )

    base_query = (
        db.query(
            Asset.id,
            Asset.title,
            AssetVersion.status,
            AssetVersion.preview_status,
            AssetVersion.faces_status,
            Asset.created_at,
            review_faces_count_sq.label("review_faces_count"),
            preview_file_id_sq.label("preview_file_id"),
        )
        .join(latest_sq, latest_sq.c.asset_id == Asset.id)
        .join(
            AssetVersion,
            and_(
                AssetVersion.asset_id == Asset.id,
                AssetVersion.version_number == latest_sq.c.max_version_number,
            ),
        )
        .filter(Asset.import_batch_id == batch.id)
        .filter(review_faces_count_sq > 0)
    )

    total = base_query.count()
    rows = (
        base_query
        .order_by(Asset.created_at.desc())
        .limit(limit)
        .offset(offset)
        .all()
    )

    items = [
        ImportBatchReviewAssetItemSchema(
            asset_id=row.id,
            title=row.title,
            status=row.status,
            preview_status=row.preview_status,
            faces_status=row.faces_status,
            review_faces_count=row.review_faces_count or 0,
            preview_file_id=row.preview_file_id,
            preview_url=_build_file_url(row.preview_file_id),
            created_at=row.created_at,
        )
        for row in rows
    ]

    return ImportBatchReviewAssetsResponseSchema(
        items=items,
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post("/{batch_id}/close", response_model=ImportBatchSchema)
def close_import_batch(
    batch_id: uuid_mod.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
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
                "Закрыть можно только партию в статусе 'uploading', "
                f"текущий: '{batch.status}'"
            ),
        )

    assets_count = (
        db.query(func.count(Asset.id))
        .filter(Asset.import_batch_id == batch.id)
        .scalar()
        or 0
    )
    if assets_count == 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Нельзя закрыть пустую партию",
        )

    latest_sq = _latest_versions_sq(db, batch.id)
    latest_versions_base = db.query(AssetVersion).join(
        latest_sq,
        and_(
            AssetVersion.asset_id == latest_sq.c.asset_id,
            AssetVersion.version_number == latest_sq.c.max_version_number,
        ),
    )

    in_flight_count = (
        latest_versions_base.filter(
            AssetVersion.preview_status.in_(
                [TASK_STATUS_PENDING, TASK_STATUS_PROCESSING]
            )
        ).count()
    )
    if in_flight_count > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Есть ассеты без готовых превью, дождитесь загрузки",
        )

    # На ML отправляем только последние версии ассетов с успешным preview.
    # Версии с preview_status=failed остаются в error — их можно перезапустить
    # через retry-failed-previews уже после закрытия партии.
    ready_version_ids = [
        v.id
        for v in latest_versions_base.filter(
            AssetVersion.preview_status == TASK_STATUS_COMPLETED
        ).all()
    ]

    batch.status = IMPORT_BATCH_STATUS_PROCESSING
    db.commit()
    db.refresh(batch)

    for vid in ready_version_ids:
        process_asset_ml.delay(str(vid))

    return _to_schema(batch, assets_count)


@router.put("/{batch_id}/project", response_model=ImportBatchSchema)
def set_import_batch_project(
    batch_id: uuid_mod.UUID,
    body: ImportBatchSetProjectRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    batch = db.query(ImportBatch).filter_by(id=batch_id).first()
    if not batch:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Партия импорта не найдена",
        )

    if body.project_id is not None:
        project = db.query(Project).filter_by(id=body.project_id).first()
        if not project:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Проект не найден",
            )

    batch.project_id = body.project_id
    db.commit()
    db.refresh(batch)

    assets_count = (
        db.query(func.count(Asset.id))
        .filter(Asset.import_batch_id == batch.id)
        .scalar()
        or 0
    )
    return _to_schema(batch, assets_count)


@router.post(
    "/{batch_id}/retry-failed-previews",
    response_model=ImportBatchRetrySummarySchema,
)
def retry_failed_previews(
    batch_id: uuid_mod.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Перезапускает preview-задачи для всех ассетов партии с preview_status=failed.

    Разрешено в любом статусе партии: упавший preview можно восстановить
    как во время активной загрузки, так и уже после закрытия партии.
    """
    batch = db.query(ImportBatch).filter_by(id=batch_id).first()
    if not batch:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Партия импорта не найдена",
        )

    latest_sq = _latest_versions_sq(db, batch.id)
    failed_versions = (
        db.query(AssetVersion)
        .join(
            latest_sq,
            and_(
                AssetVersion.asset_id == latest_sq.c.asset_id,
                AssetVersion.version_number == latest_sq.c.max_version_number,
            ),
        )
        .filter(AssetVersion.preview_status == TASK_STATUS_FAILED)
        .all()
    )

    version_ids_to_enqueue: list[str] = []
    for version in failed_versions:
        original_file = (
            db.query(AssetFileModel)
            .filter_by(asset_id=version.asset_id, purpose="original")
            .order_by(AssetFileModel.created_at.desc())
            .first()
        )
        if not original_file:
            # Без оригинала preview пересобрать невозможно — пропускаем,
            # версия останется в error.
            continue

        version.preview_status = TASK_STATUS_PENDING
        version.preview_error = None
        apply_version_status(version)
        version_ids_to_enqueue.append(str(version.id))

    if version_ids_to_enqueue:
        db.commit()
        for vid in version_ids_to_enqueue:
            process_asset_preview.delay(vid)

    return ImportBatchRetrySummarySchema(
        batch_id=batch.id,
        restarted=len(version_ids_to_enqueue),
    )


@router.post(
    "/{batch_id}/retry-failed-faces",
    response_model=ImportBatchRetrySummarySchema,
)
def retry_failed_faces(
    batch_id: uuid_mod.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Перезапускает ML-задачи для всех ассетов партии с faces_status=failed.

    Разрешено только если партия уже в processing или pending_review — в
    uploading ML ещё не запускался, там просто нечего повторять.
    Если партия была в pending_review, возвращаем её в processing, иначе
    _finalize_batch_if_done потом не сможет корректно закрыть её обратно.
    """
    batch = db.query(ImportBatch).filter_by(id=batch_id).first()
    if not batch:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Партия импорта не найдена",
        )

    if batch.status not in (
        IMPORT_BATCH_STATUS_PROCESSING,
        IMPORT_BATCH_STATUS_PENDING_REVIEW,
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Повтор faces доступен только для партий в статусе "
                f"'processing' или 'pending_review' (текущий: '{batch.status}')"
            ),
        )

    latest_sq = _latest_versions_sq(db, batch.id)
    failed_versions = (
        db.query(AssetVersion)
        .join(
            latest_sq,
            and_(
                AssetVersion.asset_id == latest_sq.c.asset_id,
                AssetVersion.version_number == latest_sq.c.max_version_number,
            ),
        )
        .filter(AssetVersion.faces_status == TASK_STATUS_FAILED)
        .filter(AssetVersion.preview_status == TASK_STATUS_COMPLETED)
        .all()
    )

    version_ids: list[str] = []
    for version in failed_versions:
        version.faces_status = TASK_STATUS_PENDING
        version.faces_error = None
        apply_version_status(version)
        version_ids.append(str(version.id))

    if version_ids and batch.status == IMPORT_BATCH_STATUS_PENDING_REVIEW:
        batch.status = IMPORT_BATCH_STATUS_PROCESSING

    if version_ids:
        db.commit()
        for vid in version_ids:
            process_asset_ml.delay(vid)

    return ImportBatchRetrySummarySchema(
        batch_id=batch.id,
        restarted=len(version_ids),
    )
