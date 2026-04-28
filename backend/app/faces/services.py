from __future__ import annotations

from uuid import UUID

import numpy as np
from sqlalchemy.orm import Session

from app.assets.models import AssetVersion
from app.faces.models import (
    FACE_REVIEW_STATE_AUTO_ASSIGNED,
    FACE_REVIEW_STATE_PENDING_REVIEW,
    FaceCandidate,
    FaceDetection,
    FaceIdentity,
    Person,
)

MATCH_SCORE_THRESHOLD = 0.55
MATCH_MARGIN_THRESHOLD = 0.10
MAX_CANDIDATES = 5
PERSON_IDENTITY_SCORE_THRESHOLD = 0.55
MANUAL_TRANSFER_SCORE_THRESHOLD = 0.75


def recalculate_centroid(db: Session, identity_id: UUID) -> None:
    identity = db.query(FaceIdentity).filter_by(id=identity_id).first()
    if not identity:
        return

    detections = (
        db.query(FaceDetection)
        .join(AssetVersion, FaceDetection.asset_version_id == AssetVersion.id)
        .filter(
            FaceDetection.identity_id == identity_id,
            FaceDetection.is_reference.is_(True),
            AssetVersion.is_identity_source.is_(True),
        )
        .all()
    )

    if not detections:
        identity.centroid_embedding = None
        identity.samples_count = 0
        return

    embeddings = np.array([d.embedding for d in detections], dtype=np.float64)
    centroid = embeddings.mean(axis=0)
    norm = np.linalg.norm(centroid)
    if norm > 0:
        centroid = centroid / norm

    identity.centroid_embedding = centroid.tolist()
    identity.samples_count = len(detections)


def compute_identity_score(embedding: list[float], centroid: list[float]) -> float:
    a = np.array(embedding, dtype=np.float64)
    b = np.array(centroid, dtype=np.float64)
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(np.dot(a, b) / (norm_a * norm_b))


def _accept_detection(
    db: Session,
    detection: FaceDetection,
    identity: FaceIdentity,
    score: float,
    source: str,
) -> None:
    detection.identity_id = identity.id
    detection.identity_score = score
    detection.assignment_source = source
    detection.is_reference = True
    if source == "model":
        detection.review_required = False
        detection.review_state = FACE_REVIEW_STATE_AUTO_ASSIGNED

    if identity.cover_face_id is None:
        identity.cover_face_id = detection.id

    db.flush()
    recalculate_centroid(db, identity.id)


def match_detection(db: Session, detection: FaceDetection) -> None:
    identities = (
        db.query(FaceIdentity)
        .filter(FaceIdentity.centroid_embedding.isnot(None))
        .all()
    )

    if not identities:
        _create_new_identity(db, detection)
        return

    emb = list(detection.embedding)
    scored: list[tuple[FaceIdentity, float]] = []
    for ident in identities:
        s = compute_identity_score(emb, list(ident.centroid_embedding))
        scored.append((ident, s))

    scored.sort(key=lambda x: x[1], reverse=True)
    top = scored[:MAX_CANDIDATES]

    for rank, (ident, s) in enumerate(top, start=1):
        db.add(
            FaceCandidate(
                face_detection_id=detection.id,
                identity_id=ident.id,
                rank=rank,
                score=round(s, 6),
            )
        )

    best_identity, best_score = top[0]
    margin = best_score - top[1][1] if len(top) >= 2 else best_score
    top_same_person = (
        len(top) >= 2
        and top[0][0].person_id is not None
        and top[0][0].person_id == top[1][0].person_id
    )

    detection.model_identity_id = best_identity.id
    detection.model_identity_score = round(best_score, 6)
    detection.model_identity_margin = round(margin, 6)

    if best_score >= MATCH_SCORE_THRESHOLD and (
        margin >= MATCH_MARGIN_THRESHOLD or top_same_person
    ):
        _accept_detection(db, detection, best_identity, best_score, "model")
    elif best_score < MATCH_SCORE_THRESHOLD:
        _create_new_identity(db, detection)


def _create_new_identity(db: Session, detection: FaceDetection) -> FaceIdentity:
    emb = list(detection.embedding)
    arr = np.array(emb, dtype=np.float64)
    norm = np.linalg.norm(arr)
    if norm > 0:
        arr = arr / norm

    identity = FaceIdentity(
        person_id=None,
        centroid_embedding=arr.tolist(),
        samples_count=1,
        cover_face_id=detection.id,
    )
    db.add(identity)
    db.flush()

    detection.identity_id = identity.id
    detection.identity_score = 1.0
    detection.assignment_source = "model"
    detection.is_reference = True
    detection.review_required = True
    detection.review_state = FACE_REVIEW_STATE_PENDING_REVIEW

    return identity


def _create_identity_for_person(
    db: Session,
    detection: FaceDetection,
    person: Person,
    source: str = "user",
) -> FaceIdentity:
    emb = list(detection.embedding)
    arr = np.array(emb, dtype=np.float64)
    norm = np.linalg.norm(arr)
    if norm > 0:
        arr = arr / norm

    identity = FaceIdentity(
        person_id=person.id,
        centroid_embedding=arr.tolist(),
        samples_count=1,
        cover_face_id=detection.id,
    )
    db.add(identity)
    db.flush()

    if person.cover_face_id is None:
        person.cover_face_id = detection.id

    detection.identity_id = identity.id
    detection.identity_score = 1.0
    detection.assignment_source = source
    detection.is_reference = True
    return identity


def _assign_existing_identity_to_person(
    detection: FaceDetection,
    identity: FaceIdentity,
    person: Person,
    source: str = "user",
) -> FaceIdentity:
    identity.person_id = person.id

    if identity.cover_face_id is None:
        identity.cover_face_id = detection.id

    if person.cover_face_id is None:
        person.cover_face_id = identity.cover_face_id or detection.id

    detection.identity_id = identity.id
    detection.assignment_source = source
    detection.is_reference = True

    if identity.centroid_embedding is not None:
        detection.identity_score = round(
            compute_identity_score(
                list(detection.embedding),
                list(identity.centroid_embedding),
            ),
            6,
        )
    elif detection.identity_score is None:
        detection.identity_score = 1.0

    return identity


def assign_detection_to_best_person_identity(
    db: Session,
    detection: FaceDetection,
    person_id: UUID,
    source: str = "user",
    min_score_to_reuse: float = PERSON_IDENTITY_SCORE_THRESHOLD,
) -> FaceIdentity:
    person = db.query(Person).filter_by(id=person_id).first()
    if not person:
        raise ValueError("Person not found")

    old_identity_id = detection.identity_id
    current_identity = detection.identity

    if current_identity and current_identity.person_id is None:
        return _assign_existing_identity_to_person(
            detection=detection,
            identity=current_identity,
            person=person,
            source=source,
        )

    emb = list(detection.embedding)
    scored: list[tuple[FaceIdentity, float]] = []
    for ident in person.identities:
        if ident.centroid_embedding is None:
            continue
        score = compute_identity_score(emb, list(ident.centroid_embedding))
        scored.append((ident, score))

    selected_identity: FaceIdentity
    selected_score: float
    if not scored:
        selected_identity = _create_identity_for_person(
            db,
            detection,
            person,
            source=source,
        )
        selected_score = 1.0
    else:
        scored.sort(key=lambda item: item[1], reverse=True)
        best_identity, best_score = scored[0]
        if best_score < min_score_to_reuse:
            selected_identity = _create_identity_for_person(
                db,
                detection,
                person,
                source=source,
            )
            selected_score = 1.0
        else:
            _accept_detection(db, detection, best_identity, best_score, source)
            selected_identity = best_identity
            selected_score = best_score

    detection.identity_score = round(selected_score, 6)

    if old_identity_id and old_identity_id != selected_identity.id:
        recalculate_centroid(db, old_identity_id)

    return selected_identity


def transfer_user_assignments_from_base_version(
    db: Session,
    target_version_id: UUID,
    base_version_id: UUID | None,
    *,
    min_score: float = MANUAL_TRANSFER_SCORE_THRESHOLD,
) -> None:
    if base_version_id is None:
        return

    source_detections = (
        db.query(FaceDetection)
        .filter(
            FaceDetection.asset_version_id == base_version_id,
            FaceDetection.identity_id.isnot(None),
            FaceDetection.assignment_source == "user",
            FaceDetection.review_required.is_(False),
        )
        .all()
    )
    if not source_detections:
        return

    target_detections = (
        db.query(FaceDetection)
        .filter(
            FaceDetection.asset_version_id == target_version_id,
            FaceDetection.identity_id.is_(None),
            FaceDetection.model_identity_id.is_(None),
        )
        .all()
    )
    if not target_detections:
        return

    scored_pairs: list[tuple[float, FaceDetection, FaceDetection]] = []
    for source in source_detections:
        for target in target_detections:
            score = compute_identity_score(
                list(source.embedding),
                list(target.embedding),
            )
            scored_pairs.append((score, source, target))

    scored_pairs.sort(key=lambda item: item[0], reverse=True)
    matched_source_ids: set[UUID] = set()
    matched_target_ids: set[UUID] = set()

    for score, source, target in scored_pairs:
        if score < min_score:
            break
        if source.id in matched_source_ids or target.id in matched_target_ids:
            continue

        target.identity_id = source.identity_id
        target.assignment_source = "user"
        target.is_reference = source.is_reference
        target.review_required = False
        target.review_state = source.review_state
        target.reviewed_by_user_id = source.reviewed_by_user_id
        target.reviewed_at = source.reviewed_at

        identity = source.identity or (
            db.query(FaceIdentity).filter_by(id=source.identity_id).first()
        )
        if identity and identity.centroid_embedding is not None:
            target.identity_score = round(
                compute_identity_score(
                    list(target.embedding),
                    list(identity.centroid_embedding),
                ),
                6,
            )
        else:
            target.identity_score = source.identity_score or round(score, 6)

        matched_source_ids.add(source.id)
        matched_target_ids.add(target.id)

    db.flush()


def match_detections_for_version(db: Session, asset_version_id: UUID | str) -> None:
    detections = (
        db.query(FaceDetection)
        .filter(
            FaceDetection.asset_version_id == str(asset_version_id),
            FaceDetection.identity_id.is_(None),
            FaceDetection.model_identity_id.is_(None),
        )
        .order_by(FaceDetection.face_index)
        .all()
    )

    for det in detections:
        match_detection(db, det)
        db.flush()


def match_detections_for_asset(db: Session, asset_id: UUID | str) -> None:
    version = (
        db.query(AssetVersion)
        .filter(AssetVersion.asset_id == str(asset_id))
        .order_by(AssetVersion.version_number.desc())
        .first()
    )
    if version:
        match_detections_for_version(db, version.id)


def promote_identity_source_version(db: Session, version_id: UUID | str) -> None:
    version = db.query(AssetVersion).filter_by(id=version_id).first()
    if not version:
        return

    existing_sources = (
        db.query(AssetVersion)
        .filter(
            AssetVersion.asset_id == version.asset_id,
            AssetVersion.is_identity_source.is_(True),
        )
        .all()
    )

    affected_version_ids: set[UUID] = {version.id}
    for source_version in existing_sources:
        if source_version.id != version.id:
            source_version.is_identity_source = False
        affected_version_ids.add(source_version.id)

    version.is_identity_source = True
    db.flush()

    identity_ids = {
        row[0]
        for row in (
            db.query(FaceDetection.identity_id)
            .filter(
                FaceDetection.asset_version_id.in_(affected_version_ids),
                FaceDetection.identity_id.isnot(None),
                FaceDetection.is_reference.is_(True),
            )
            .all()
        )
        if row[0] is not None
    }

    for identity_id in identity_ids:
        recalculate_centroid(db, identity_id)
