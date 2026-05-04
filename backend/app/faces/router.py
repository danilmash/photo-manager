import uuid as uuid_mod
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from sqlalchemy import select, func, distinct
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.assets.models import ASSET_LIFECYCLE_ACTIVE, Asset
from app.users.dependencies import get_current_user
from app.users.models import User
from app.faces.models import (
    FACE_REVIEW_STATE_UNRESOLVED,
    FACE_REVIEW_STATE_USER_CONFIRMED,
    FACE_REVIEW_STATE_USER_CORRECTED,
    FaceDetection,
    FaceIdentity,
    Person,
)
from app.faces.schemas import (
    AssignNewPersonRequest,
    AssignIdentityNewPersonRequest,
    AssignIdentityPersonRequest,
    AssignPersonRequest,
    AssignIdentityRequest,
    FaceAssignmentResponse,
    IdentityAssignmentResponse,
    ImportBatchFaceClusterDetectionSchema,
    ImportBatchFaceClusterSchema,
    PersonListItemSchema,
)
from app.faces.services import (
    assign_detection_to_best_person_identity,
    compute_identity_score,
    recalculate_centroid,
)

router = APIRouter(prefix="/api/v1/faces", tags=["faces"])


def _get_detection_or_404(db: Session, detection_id: uuid_mod.UUID) -> FaceDetection:
    det = db.query(FaceDetection).filter_by(id=detection_id).first()
    if not det:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Detection not found",
        )
    return det


def _get_identity_or_404(db: Session, identity_id: uuid_mod.UUID) -> FaceIdentity:
    ident = db.query(FaceIdentity).filter_by(id=identity_id).first()
    if not ident:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Identity not found",
        )
    return ident


def _mark_detection_reviewed(
    det: FaceDetection,
    current_user: User,
    *,
    corrected: bool,
) -> None:
    det.review_required = False
    det.review_state = (
        FACE_REVIEW_STATE_USER_CORRECTED
        if corrected
        else FACE_REVIEW_STATE_USER_CONFIRMED
    )
    det.reviewed_by_user_id = current_user.id
    det.reviewed_at = datetime.utcnow()


def _mark_identity_batch_reviewed(
    db: Session,
    identity_id: uuid_mod.UUID,
    batch_id: uuid_mod.UUID,
    current_user: User,
) -> int:
    detections = (
        db.query(FaceDetection)
        .join(Asset, FaceDetection.asset_id == Asset.id)
        .filter(
            FaceDetection.identity_id == identity_id,
            Asset.import_batch_id == batch_id,
            Asset.lifecycle_status == ASSET_LIFECYCLE_ACTIVE,
        )
        .all()
    )
    for det in detections:
        corrected = (
            det.model_identity_id is not None
            and det.model_identity_id != det.identity_id
        )
        _mark_detection_reviewed(det, current_user, corrected=corrected)
    return len(detections)


def _identity_assignment_response(
    db: Session,
    identity: FaceIdentity,
    batch_id: uuid_mod.UUID,
) -> IdentityAssignmentResponse:
    pending = (
        db.query(func.count(FaceDetection.id))
        .join(Asset, FaceDetection.asset_id == Asset.id)
        .filter(
            FaceDetection.identity_id == identity.id,
            FaceDetection.review_required.is_(True),
            Asset.import_batch_id == batch_id,
            Asset.lifecycle_status == ASSET_LIFECYCLE_ACTIVE,
        )
        .scalar()
        or 0
    )
    return IdentityAssignmentResponse(
        identity_id=identity.id,
        person_id=identity.person_id,
        person_name=identity.person.name if identity.person else None,
        review_required_count=pending,
    )


@router.post(
    "/{detection_id}/assign",
    response_model=FaceAssignmentResponse,
)
def assign_identity(
    detection_id: uuid_mod.UUID,
    body: AssignIdentityRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    det = _get_detection_or_404(db, detection_id)
    identity = _get_identity_or_404(db, body.identity_id)

    old_identity_id = det.identity_id

    score = 1.0
    if identity.centroid_embedding is not None:
        score = compute_identity_score(
            list(det.embedding),
            list(identity.centroid_embedding),
        )

    det.identity_id = identity.id
    det.identity_score = round(score, 6)
    det.assignment_source = "user"
    det.is_reference = True
    corrected = (
        det.model_identity_id is not None
        and det.model_identity_id != identity.id
    )
    _mark_detection_reviewed(det, current_user, corrected=corrected)

    if identity.cover_face_id is None:
        identity.cover_face_id = det.id

    db.flush()
    recalculate_centroid(db, identity.id)

    if old_identity_id and old_identity_id != identity.id:
        recalculate_centroid(db, old_identity_id)

    db.commit()

    return FaceAssignmentResponse(
        detection_id=det.id,
        identity_id=det.identity_id,
        identity_score=det.identity_score,
        assignment_source=det.assignment_source,
        is_reference=det.is_reference,
    )


@router.post(
    "/{detection_id}/assign-person",
    response_model=FaceAssignmentResponse,
)
def assign_person(
    detection_id: uuid_mod.UUID,
    body: AssignPersonRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    det = _get_detection_or_404(db, detection_id)

    try:
        assign_detection_to_best_person_identity(
            db=db,
            detection=det,
            person_id=body.person_id,
            source="user",
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc

    corrected = (
        det.model_identity_id is not None
        and det.model_identity_id != det.identity_id
    )
    _mark_detection_reviewed(det, current_user, corrected=corrected)

    db.commit()

    return FaceAssignmentResponse(
        detection_id=det.id,
        identity_id=det.identity_id,
        identity_score=det.identity_score,
        assignment_source=det.assignment_source,
        is_reference=det.is_reference,
    )


@router.post(
    "/{detection_id}/assign-new-person",
    response_model=FaceAssignmentResponse,
)
def assign_new_person(
    detection_id: uuid_mod.UUID,
    body: AssignNewPersonRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    det = _get_detection_or_404(db, detection_id)

    person = Person(name=(body.name or "").strip())
    db.add(person)
    db.flush()

    assign_detection_to_best_person_identity(
        db=db,
        detection=det,
        person_id=person.id,
        source="user",
    )
    _mark_detection_reviewed(det, current_user, corrected=True)
    db.commit()

    return FaceAssignmentResponse(
        detection_id=det.id,
        identity_id=det.identity_id,
        identity_score=det.identity_score,
        assignment_source=det.assignment_source,
        is_reference=det.is_reference,
    )


@router.post(
    "/{detection_id}/unassign",
    response_model=FaceAssignmentResponse,
)
def unassign_identity(
    detection_id: uuid_mod.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    det = _get_detection_or_404(db, detection_id)

    old_identity_id = det.identity_id
    if not old_identity_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Detection is not assigned to any identity",
        )

    det.identity_id = None
    det.identity_score = None
    det.assignment_source = "user"
    det.is_reference = False
    det.review_required = True
    det.review_state = FACE_REVIEW_STATE_UNRESOLVED
    det.reviewed_by_user_id = current_user.id
    det.reviewed_at = datetime.utcnow()

    db.flush()
    recalculate_centroid(db, old_identity_id)
    db.commit()

    return FaceAssignmentResponse(
        detection_id=det.id,
        identity_id=None,
        identity_score=None,
        assignment_source=det.assignment_source,
        is_reference=False,
    )


@router.get(
    "/import-batches/{batch_id}/identity-clusters",
    response_model=list[ImportBatchFaceClusterSchema],
)
def list_import_batch_identity_clusters(
    batch_id: uuid_mod.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rows = (
        db.query(FaceIdentity)
        .join(FaceDetection, FaceDetection.identity_id == FaceIdentity.id)
        .join(Asset, FaceDetection.asset_id == Asset.id)
        .filter(
            Asset.import_batch_id == batch_id,
            Asset.lifecycle_status == ASSET_LIFECYCLE_ACTIVE,
            Asset.owner_id == current_user.id,
        )
        .distinct()
        .order_by(FaceIdentity.samples_count.desc(), FaceIdentity.created_at.asc())
        .all()
    )

    clusters: list[ImportBatchFaceClusterSchema] = []
    for identity in rows:
        detections = (
            db.query(FaceDetection, Asset.title)
            .join(Asset, FaceDetection.asset_id == Asset.id)
            .filter(
                FaceDetection.identity_id == identity.id,
                Asset.import_batch_id == batch_id,
                Asset.lifecycle_status == ASSET_LIFECYCLE_ACTIVE,
                Asset.owner_id == current_user.id,
            )
            .order_by(
                FaceDetection.review_required.desc(),
                FaceDetection.quality_score.desc().nullslast(),
                FaceDetection.confidence.desc(),
            )
            .all()
        )

        detection_items = [
            ImportBatchFaceClusterDetectionSchema(
                id=det.id,
                asset_id=det.asset_id,
                asset_title=asset_title,
                crop_url=_build_crop_url(det.id),
                confidence=det.confidence,
                quality_score=det.quality_score,
                review_required=det.review_required,
                review_state=det.review_state,
            )
            for det, asset_title in detections
        ]
        review_required_count = sum(1 for item in detection_items if item.review_required)
        clusters.append(
            ImportBatchFaceClusterSchema(
                identity_id=identity.id,
                person_id=identity.person_id,
                person_name=identity.person.name if identity.person else None,
                cover_url=_build_crop_url(identity.cover_face_id),
                samples_count=identity.samples_count,
                detections_count=len(detection_items),
                review_required_count=review_required_count,
                detections=detection_items,
            )
        )

    return clusters


@router.post(
    "/import-batches/{batch_id}/identity-clusters/{identity_id}/assign-person",
    response_model=IdentityAssignmentResponse,
)
def assign_import_batch_identity_person(
    batch_id: uuid_mod.UUID,
    identity_id: uuid_mod.UUID,
    body: AssignIdentityPersonRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    identity = _get_identity_or_404(db, identity_id)
    person = db.query(Person).filter_by(id=body.person_id).first()
    if not person:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Person not found",
        )

    identity.person_id = person.id
    if person.cover_face_id is None:
        person.cover_face_id = identity.cover_face_id
    _mark_identity_batch_reviewed(db, identity.id, batch_id, current_user)
    db.commit()
    return _identity_assignment_response(db, identity, batch_id)


@router.post(
    "/import-batches/{batch_id}/identity-clusters/{identity_id}/assign-new-person",
    response_model=IdentityAssignmentResponse,
)
def assign_import_batch_identity_new_person(
    batch_id: uuid_mod.UUID,
    identity_id: uuid_mod.UUID,
    body: AssignIdentityNewPersonRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    identity = _get_identity_or_404(db, identity_id)
    person = Person(name=(body.name or "").strip())
    db.add(person)
    db.flush()

    identity.person_id = person.id
    if person.cover_face_id is None:
        person.cover_face_id = identity.cover_face_id
    _mark_identity_batch_reviewed(db, identity.id, batch_id, current_user)
    db.commit()
    return _identity_assignment_response(db, identity, batch_id)


@router.post(
    "/import-batches/{batch_id}/identity-clusters/{identity_id}/unassign",
    response_model=IdentityAssignmentResponse,
)
def unassign_import_batch_identity_person(
    batch_id: uuid_mod.UUID,
    identity_id: uuid_mod.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    identity = _get_identity_or_404(db, identity_id)
    identity.person_id = None
    detections = (
        db.query(FaceDetection)
        .join(Asset, FaceDetection.asset_id == Asset.id)
        .filter(
            FaceDetection.identity_id == identity.id,
            Asset.import_batch_id == batch_id,
            Asset.lifecycle_status == ASSET_LIFECYCLE_ACTIVE,
            Asset.owner_id == current_user.id,
        )
        .all()
    )
    for det in detections:
        det.review_required = True
        det.review_state = FACE_REVIEW_STATE_UNRESOLVED
        det.reviewed_by_user_id = current_user.id
        det.reviewed_at = datetime.utcnow()
    db.commit()
    return _identity_assignment_response(db, identity, batch_id)


@router.get("/crops/{detection_id}")
def get_face_crop(
    detection_id: uuid_mod.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    det = _get_detection_or_404(db, detection_id)

    if not det.crop_path:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Crop not available for this detection",
        )

    path = Path(settings.storage_root) / det.crop_path
    if not path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Crop file not found on disk",
        )

    return FileResponse(path, media_type="image/jpeg")


def _build_crop_url(detection_id: uuid_mod.UUID | None) -> str | None:
    if not detection_id:
        return None
    return f"/api/v1/faces/crops/{detection_id}"


@router.get("/persons", response_model=list[PersonListItemSchema])
def list_persons(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    photos_count_sq = (
        select(func.count(distinct(FaceDetection.asset_id)))
        .join(FaceIdentity, FaceDetection.identity_id == FaceIdentity.id)
        .where(FaceIdentity.person_id == Person.id)
        .correlate(Person)
        .scalar_subquery()
    )

    rows = (
        db.query(
            Person.id,
            Person.name,
            Person.cover_face_id,
            photos_count_sq.label("photos_count"),
        )
        .order_by(photos_count_sq.desc())
        .all()
    )

    return [
        PersonListItemSchema(
            id=row.id,
            name=row.name,
            photos_count=row.photos_count or 0,
            cover_url=_build_crop_url(row.cover_face_id),
        )
        for row in rows
    ]
