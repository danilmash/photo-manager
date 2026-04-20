import uuid as uuid_mod

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.assets.models import Asset
from app.database import get_db
from app.import_batches.models import (
    IMPORT_BATCH_STATUS_PENDING_REVIEW,
    IMPORT_BATCH_STATUS_UPLOADING,
    ImportBatch,
)
from app.import_batches.schemas import (
    ImportBatchCreateRequest,
    ImportBatchSchema,
    ImportBatchSetProjectRequest,
)
from app.projects.models import Project
from app.users.dependencies import get_current_user
from app.users.models import User

router = APIRouter(prefix="/api/v1/import-batches", tags=["import-batches"])


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

    batch.status = IMPORT_BATCH_STATUS_PENDING_REVIEW
    db.commit()
    db.refresh(batch)

    assets_count = (
        db.query(func.count(Asset.id))
        .filter(Asset.import_batch_id == batch.id)
        .scalar()
        or 0
    )
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
