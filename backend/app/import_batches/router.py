import uuid as uuid_mod
import re
from collections import Counter, defaultdict
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app.assets.models import (
    ASSET_LIFECYCLE_ACTIVE,
    DUPLICATE_DECISION_CONFIRMED,
    DUPLICATE_DECISION_KEPT_BOTH,
    DUPLICATE_DECISION_REJECTED,
    DUPLICATE_REVIEW_PENDING,
    DUPLICATE_REVIEW_REVIEWED,
    TASK_STATUS_COMPLETED,
    TASK_STATUS_FAILED,
    TASK_STATUS_PENDING,
    TASK_STATUS_PROCESSING,
    Asset,
    AssetDuplicateCandidate,
    AssetVersion,
    File as AssetFileModel,
    apply_version_status,
)
from app.faces.models import FaceDetection
from app.assets.tasks import process_asset_ml
from app.database import get_db
from app.import_batches.models import (
    IMPORT_BATCH_STATUS_ACCEPTED,
    IMPORT_BATCH_STATUS_CANCELLED,
    IMPORT_BATCH_STATUS_PENDING_REVIEW,
    IMPORT_BATCH_STATUS_PROCESSING,
    IMPORT_BATCH_STATUS_UPLOADING,
    ImportBatch,
)
from app.import_batches.schemas import (
    DuplicateCandidateReviewRequest,
    ImportBatchCreateRequest,
    ImportBatchDuplicateCandidateItemSchema,
    ImportBatchDuplicateGroupSchema,
    ImportBatchDuplicatesResponseSchema,
    ImportBatchReviewAssetItemSchema,
    ImportBatchReviewAssetsResponseSchema,
    ImportBatchRetrySummarySchema,
    ImportBatchSchema,
    ImportBatchSetProjectRequest,
    ImportBatchTagSuggestionItemSchema,
    ImportBatchTagSuggestionsResponseSchema,
    ImportBatchTagsApplyRequest,
    ImportBatchTagsApplyResponse,
)
from app.projects.models import Project
from app.users.dependencies import get_current_user
from app.users.models import User

router = APIRouter(prefix="/api/v1/import-batches", tags=["import-batches"])

MAX_BATCH_TAGS = 30
MAX_TAG_LENGTH = 64
TAG_SUGGESTION_LIMIT = 12
SIMILAR_BATCH_LIMIT = 5
SPACE_RE = re.compile(r"\s+")


def _latest_versions_sq(db: Session, batch_id):
    """Одна строка на ассет: максимальный version_number среди версий партии."""
    return (
        db.query(
            AssetVersion.asset_id.label("asset_id"),
            func.max(AssetVersion.version_number).label("max_version_number"),
        )
        .join(Asset, AssetVersion.asset_id == Asset.id)
        .filter(Asset.import_batch_id == batch_id)
        .filter(Asset.lifecycle_status == ASSET_LIFECYCLE_ACTIVE)
        .group_by(AssetVersion.asset_id)
        .subquery()
    )


def _assets_count_subquery():
    return (
        select(func.count(Asset.id))
        .where(
            Asset.import_batch_id == ImportBatch.id,
            Asset.lifecycle_status == ASSET_LIFECYCLE_ACTIVE,
        )
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


def _normalize_tag(value: str) -> str | None:
    tag = SPACE_RE.sub(" ", value.strip())
    if not tag:
        return None
    if len(tag) > MAX_TAG_LENGTH:
        tag = tag[:MAX_TAG_LENGTH].rstrip()
    return tag or None


def _normalize_tags(values: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for value in values[:MAX_BATCH_TAGS]:
        tag = _normalize_tag(value)
        if tag is None:
            continue
        key = tag.casefold()
        if key in seen:
            continue
        seen.add(key)
        out.append(tag)
    return out


def _keywords_list(value) -> list[str]:
    if not isinstance(value, list):
        return []
    out: list[str] = []
    for item in value:
        if isinstance(item, str):
            tag = _normalize_tag(item)
            if tag is not None:
                out.append(tag)
    return _normalize_tags(out)


def _suggestion_items(counter: Counter[str], limit: int = TAG_SUGGESTION_LIMIT):
    return [
        ImportBatchTagSuggestionItemSchema(tag=tag, count=count)
        for tag, count in counter.most_common(limit)
    ]


def _latest_versions_query(db: Session, batch_id: uuid_mod.UUID | None = None):
    latest_sq = (
        db.query(
            AssetVersion.asset_id.label("asset_id"),
            func.max(AssetVersion.version_number).label("max_version_number"),
        )
        .join(Asset, AssetVersion.asset_id == Asset.id)
        .filter(Asset.lifecycle_status == ASSET_LIFECYCLE_ACTIVE)
    )
    if batch_id is not None:
        latest_sq = latest_sq.filter(Asset.import_batch_id == batch_id)
    latest_sq = latest_sq.group_by(AssetVersion.asset_id).subquery()

    query = (
        db.query(AssetVersion, Asset.import_batch_id)
        .join(Asset, AssetVersion.asset_id == Asset.id)
        .join(
            latest_sq,
            and_(
                AssetVersion.asset_id == latest_sq.c.asset_id,
                AssetVersion.version_number == latest_sq.c.max_version_number,
            ),
        )
        .filter(Asset.lifecycle_status == ASSET_LIFECYCLE_ACTIVE)
    )
    if batch_id is not None:
        query = query.filter(Asset.import_batch_id == batch_id)
    return query


def _preview_file_ids_for_assets(
    db: Session,
    batch_id: uuid_mod.UUID,
    asset_ids: set[uuid_mod.UUID],
) -> dict[uuid_mod.UUID, uuid_mod.UUID]:
    if not asset_ids:
        return {}
    latest_sq = _latest_versions_sq(db, batch_id)
    version_rows = (
        db.query(AssetVersion.id, AssetVersion.asset_id)
        .join(
            latest_sq,
            and_(
                AssetVersion.asset_id == latest_sq.c.asset_id,
                AssetVersion.version_number == latest_sq.c.max_version_number,
            ),
        )
        .filter(AssetVersion.asset_id.in_(asset_ids))
        .all()
    )
    vid_to_aid = {row.id: row.asset_id for row in version_rows}
    version_ids = list(vid_to_aid.keys())
    if not version_ids:
        return {}
    files = (
        db.query(AssetFileModel)
        .filter(
            AssetFileModel.asset_version_id.in_(version_ids),
            AssetFileModel.purpose == "preview",
        )
        .order_by(AssetFileModel.created_at.desc())
        .all()
    )
    out: dict[uuid_mod.UUID, uuid_mod.UUID] = {}
    for f in files:
        aid = vid_to_aid.get(f.asset_version_id)
        if aid is not None and aid not in out:
            out[aid] = f.id
    return out


def _batch_review_blockers(
    db: Session,
    batch_id: uuid_mod.UUID,
) -> tuple[int, int]:
    """Число непроверенных дубликатов и лиц, блокирующих accept партии."""
    pending_duplicates = (
        db.query(func.count(AssetDuplicateCandidate.id))
        .join(Asset, AssetDuplicateCandidate.source_asset_id == Asset.id)
        .filter(
            Asset.import_batch_id == batch_id,
            Asset.lifecycle_status == ASSET_LIFECYCLE_ACTIVE,
            AssetDuplicateCandidate.review_decision.is_(None),
        )
        .scalar()
        or 0
    )
    pending_faces = (
        db.query(func.count(FaceDetection.id))
        .join(Asset, FaceDetection.asset_id == Asset.id)
        .filter(
            Asset.import_batch_id == batch_id,
            Asset.lifecycle_status == ASSET_LIFECYCLE_ACTIVE,
            FaceDetection.review_required.is_(True),
        )
        .scalar()
        or 0
    )
    return pending_duplicates, pending_faces


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
    unassigned_only: bool = Query(
        default=False,
        description=(
            "Только фото с лицами вне кластера "
            "(review_required и identity_id IS NULL)"
        ),
    ),
):
    batch = db.query(ImportBatch).filter_by(id=batch_id).first()
    if not batch:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Партия импорта не найдена",
        )

    review_face_conditions = [
        FaceDetection.asset_id == Asset.id,
        FaceDetection.review_required.is_(True),
    ]
    if unassigned_only:
        review_face_conditions.append(FaceDetection.identity_id.is_(None))

    review_faces_count_sq = (
        select(func.count(FaceDetection.id))
        .where(*review_face_conditions)
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
        .filter(Asset.lifecycle_status == ASSET_LIFECYCLE_ACTIVE)
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


@router.post("/{batch_id}/tags", response_model=ImportBatchTagsApplyResponse)
def apply_import_batch_tags(
    batch_id: uuid_mod.UUID,
    body: ImportBatchTagsApplyRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    batch = db.query(ImportBatch).filter_by(id=batch_id).first()
    if not batch:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Партия импорта не найдена",
        )

    tags = _normalize_tags(body.tags)
    if not tags:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Укажите хотя бы один тег",
        )

    rows = _latest_versions_query(db, batch.id).all()
    updated_assets = 0
    for version, _batch_id in rows:
        existing = _keywords_list(version.keywords)
        seen = {tag.casefold() for tag in existing}
        merged = existing[:]
        for tag in tags:
            key = tag.casefold()
            if key not in seen:
                seen.add(key)
                merged.append(tag)

        if merged != existing:
            version.keywords = merged
            updated_assets += 1

    if updated_assets:
        db.commit()

    return ImportBatchTagsApplyResponse(
        batch_id=batch.id,
        updated_assets=updated_assets,
        tags=tags,
    )


@router.get(
    "/{batch_id}/tag-suggestions",
    response_model=ImportBatchTagSuggestionsResponseSchema,
)
def get_import_batch_tag_suggestions(
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

    rows = (
        _latest_versions_query(db)
        .filter(Asset.import_batch_id.is_not(None))
        .order_by(AssetVersion.created_at.desc())
        .all()
    )

    recent_counter: Counter[str] = Counter()
    popular_counter: Counter[str] = Counter()
    current_tags_counter: Counter[str] = Counter()
    batch_counters: dict[uuid_mod.UUID, Counter[str]] = defaultdict(Counter)

    for version, row_batch_id in rows:
        tags = _keywords_list(version.keywords)
        if not tags or row_batch_id is None:
            continue

        for tag in tags:
            popular_counter[tag] += 1
            batch_counters[row_batch_id][tag] += 1
            if row_batch_id == batch.id:
                current_tags_counter[tag] += 1

        if len(recent_counter) < TAG_SUGGESTION_LIMIT:
            for tag in tags:
                if tag not in recent_counter:
                    recent_counter[tag] = 1
                    if len(recent_counter) >= TAG_SUGGESTION_LIMIT:
                        break

    current_tag_keys = {tag.casefold() for tag in current_tags_counter}
    similar_counter: Counter[str] = Counter()
    if current_tag_keys:
        similar_scores: list[tuple[float, uuid_mod.UUID]] = []
        for other_batch_id, counter in batch_counters.items():
            if other_batch_id == batch.id:
                continue
            other_keys = {tag.casefold() for tag in counter}
            intersection = current_tag_keys & other_keys
            if not intersection:
                continue
            union = current_tag_keys | other_keys
            similar_scores.append((len(intersection) / len(union), other_batch_id))

        similar_scores.sort(key=lambda item: item[0], reverse=True)
        for _score, other_batch_id in similar_scores[:SIMILAR_BATCH_LIMIT]:
            for tag, count in batch_counters[other_batch_id].items():
                if tag.casefold() not in current_tag_keys:
                    similar_counter[tag] += count

    return ImportBatchTagSuggestionsResponseSchema(
        recent=_suggestion_items(recent_counter),
        popular=_suggestion_items(popular_counter),
        similar_batches=_suggestion_items(similar_counter),
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
        .filter(Asset.lifecycle_status == ASSET_LIFECYCLE_ACTIVE)
        .scalar()
        or 0
    )
    if assets_count == 0:
        batch.status = IMPORT_BATCH_STATUS_CANCELLED
        db.commit()
        db.refresh(batch)
        return _to_schema(batch, assets_count)

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
    # Неудачные preview удаляются из системы на этапе process_asset_preview.
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


@router.post("/{batch_id}/accept", response_model=ImportBatchSchema)
def accept_import_batch(
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

    if batch.status != IMPORT_BATCH_STATUS_PENDING_REVIEW:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Принять можно только партию в статусе 'pending_review', "
                f"текущий: '{batch.status}'"
            ),
        )

    pending_duplicates, pending_faces = _batch_review_blockers(db, batch_id)
    if pending_duplicates > 0 or pending_faces > 0:
        parts: list[str] = []
        if pending_duplicates > 0:
            parts.append(f"{pending_duplicates} дубликатов")
        if pending_faces > 0:
            parts.append(f"{pending_faces} лиц")
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Осталось проверить {' и '.join(parts)}",
        )

    batch.status = IMPORT_BATCH_STATUS_ACCEPTED
    db.commit()
    db.refresh(batch)

    assets_count = (
        db.query(func.count(Asset.id))
        .filter(Asset.import_batch_id == batch.id)
        .filter(Asset.lifecycle_status == ASSET_LIFECYCLE_ACTIVE)
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
        .filter(Asset.lifecycle_status == ASSET_LIFECYCLE_ACTIVE)
        .scalar()
        or 0
    )
    return _to_schema(batch, assets_count)


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


@router.get(
    "/{batch_id}/duplicate-groups",
    response_model=ImportBatchDuplicatesResponseSchema,
)
def list_import_batch_duplicate_groups(
    batch_id: uuid_mod.UUID,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    batch = db.query(ImportBatch).filter_by(id=batch_id).first()
    if not batch:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Партия импорта не найдена",
        )

    candidates = (
        db.query(AssetDuplicateCandidate)
        .join(Asset, AssetDuplicateCandidate.source_asset_id == Asset.id)
        .filter(
            Asset.import_batch_id == batch_id,
        )
        .order_by(
            AssetDuplicateCandidate.source_asset_id,
            AssetDuplicateCandidate.rank,
        )
        .all()
    )

    grouped: dict[uuid_mod.UUID, list[AssetDuplicateCandidate]] = defaultdict(list)
    asset_ids: set[uuid_mod.UUID] = set()
    for row in candidates:
        grouped[row.source_asset_id].append(row)
        asset_ids.add(row.source_asset_id)
        asset_ids.add(row.candidate_asset_id)

    preview_map = _preview_file_ids_for_assets(db, batch_id, asset_ids)
    assets_meta = {
        a.id: a for a in db.query(Asset).filter(Asset.id.in_(asset_ids)).all()
    }

    groups: list[ImportBatchDuplicateGroupSchema] = []
    for source_id, rows in grouped.items():
        src = assets_meta.get(source_id)
        groups.append(
            ImportBatchDuplicateGroupSchema(
                source_asset_id=source_id,
                source_title=src.title if src else None,
                source_preview_url=_build_file_url(preview_map.get(source_id)),
                duplicate_review_status=(
                    src.duplicate_review_status if src else DUPLICATE_REVIEW_PENDING
                ),
                candidates=[
                    ImportBatchDuplicateCandidateItemSchema(
                        id=r.id,
                        candidate_asset_id=r.candidate_asset_id,
                        candidate_title=(
                            assets_meta[r.candidate_asset_id].title
                            if r.candidate_asset_id in assets_meta
                            else None
                        ),
                        candidate_preview_url=_build_file_url(
                            preview_map.get(r.candidate_asset_id),
                        ),
                        duplicate_type=r.duplicate_type,
                        score=r.score,
                        distance=r.distance,
                        rank=r.rank,
                        review_decision=r.review_decision,
                    )
                    for r in rows
                ],
            )
        )

    return ImportBatchDuplicatesResponseSchema(groups=groups)


@router.patch(
    "/{batch_id}/duplicate-candidates/{candidate_row_id}",
    response_model=ImportBatchDuplicateCandidateItemSchema,
)
def review_import_batch_duplicate_candidate(
    batch_id: uuid_mod.UUID,
    candidate_row_id: uuid_mod.UUID,
    body: DuplicateCandidateReviewRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    batch = db.query(ImportBatch).filter_by(id=batch_id).first()
    if not batch:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Партия импорта не найдена",
        )

    candidate_row = db.query(AssetDuplicateCandidate).filter_by(id=candidate_row_id).first()
    if not candidate_row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Запись кандидата не найдена",
        )

    source_asset = db.query(Asset).filter_by(id=candidate_row.source_asset_id).first()
    if not source_asset or source_asset.import_batch_id != batch_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Запись кандидата не найдена",
        )

    cand_asset = db.query(Asset).filter_by(id=candidate_row.candidate_asset_id).first()
    if not cand_asset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Ассет-кандидат не найден",
        )

    if body.decision == DUPLICATE_DECISION_CONFIRMED:
        cand_asset.duplicate_of_asset_id = candidate_row.source_asset_id
    elif body.decision in (DUPLICATE_DECISION_REJECTED, DUPLICATE_DECISION_KEPT_BOTH):
        if cand_asset.duplicate_of_asset_id == candidate_row.source_asset_id:
            cand_asset.duplicate_of_asset_id = None

    candidate_row.review_decision = body.decision
    candidate_row.reviewed_at = datetime.utcnow()
    candidate_row.reviewed_by_user_id = current_user.id
    cand_asset.duplicate_review_status = DUPLICATE_REVIEW_REVIEWED

    db.flush()
    pending_for_source = (
        db.query(func.count(AssetDuplicateCandidate.id))
        .filter(
            AssetDuplicateCandidate.source_asset_id == candidate_row.source_asset_id,
            AssetDuplicateCandidate.review_decision.is_(None),
        )
        .scalar()
        or 0
    )
    if pending_for_source == 0:
        source_asset.duplicate_review_status = DUPLICATE_REVIEW_REVIEWED

    db.commit()

    preview_map = _preview_file_ids_for_assets(
        db,
        batch_id,
        {candidate_row.candidate_asset_id},
    )
    return ImportBatchDuplicateCandidateItemSchema(
        id=candidate_row.id,
        candidate_asset_id=candidate_row.candidate_asset_id,
        candidate_title=cand_asset.title,
        candidate_preview_url=_build_file_url(
            preview_map.get(candidate_row.candidate_asset_id),
        ),
        duplicate_type=candidate_row.duplicate_type,
        score=candidate_row.score,
        distance=candidate_row.distance,
        rank=candidate_row.rank,
        review_decision=candidate_row.review_decision,
    )
