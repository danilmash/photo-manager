import uuid as uuid_mod
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from sqlalchemy import select, func, distinct
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.users.dependencies import get_current_user
from app.users.models import User
from app.faces.models import FaceDetection, FaceIdentity, Person
from app.faces.schemas import (
    AssignIdentityRequest,
    FaceAssignmentResponse,
    PersonListItemSchema,
)
from app.faces.services import compute_identity_score, recalculate_centroid

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
    det.assignment_source = None
    det.is_reference = False

    db.flush()
    recalculate_centroid(db, old_identity_id)
    db.commit()

    return FaceAssignmentResponse(
        detection_id=det.id,
        identity_id=None,
        identity_score=None,
        assignment_source=None,
        is_reference=False,
    )


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
