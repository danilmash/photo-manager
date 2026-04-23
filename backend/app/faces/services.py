from __future__ import annotations

from uuid import UUID

import numpy as np
from sqlalchemy.orm import Session

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


def recalculate_centroid(db: Session, identity_id: UUID) -> None:
    """Recompute the L2-normalised centroid embedding for a FaceIdentity
    using only ``is_reference=True`` detections.
    """
    identity = db.query(FaceIdentity).filter_by(id=identity_id).first()
    if not identity:
        return

    detections = (
        db.query(FaceDetection)
        .filter_by(identity_id=identity_id, is_reference=True)
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
    """Cosine similarity between a face embedding and an identity centroid."""
    a = np.array(embedding, dtype=np.float64)
    b = np.array(centroid, dtype=np.float64)
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(np.dot(a, b) / (norm_a * norm_b))


# ---------------------------------------------------------------------------
# Matching pipeline
# ---------------------------------------------------------------------------

def _accept_detection(
    db: Session,
    detection: FaceDetection,
    identity: FaceIdentity,
    score: float,
    source: str,
) -> None:
    """Link a detection to an identity and mark it as reference."""
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
    """Match a single unmatched detection against all known identities."""

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
        db.add(FaceCandidate(
            face_detection_id=detection.id,
            identity_id=ident.id,
            rank=rank,
            score=round(s, 6),
        ))

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
    else:
        if best_score < MATCH_SCORE_THRESHOLD:
            _create_new_identity(db, detection)


def _create_new_identity(db: Session, detection: FaceDetection) -> FaceIdentity:
    """Create an unresolved identity and mark detection for user review."""
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
    """Create a new identity under an existing person and assign detection."""
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


def assign_detection_to_best_person_identity(
    db: Session,
    detection: FaceDetection,
    person_id: UUID,
    source: str = "user",
    min_score_to_reuse: float = PERSON_IDENTITY_SCORE_THRESHOLD,
) -> FaceIdentity:
    """Assign detection to the best identity of a person or create a new one.

    If the best available identity centroid score is below ``min_score_to_reuse``,
    a new identity is created under the given person.
    """
    person = db.query(Person).filter_by(id=person_id).first()
    if not person:
        raise ValueError("Person not found")

    old_identity_id = detection.identity_id
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
        selected_identity = _create_identity_for_person(db, detection, person, source=source)
        selected_score = 1.0
    else:
        scored.sort(key=lambda item: item[1], reverse=True)
        best_identity, best_score = scored[0]
        if best_score < min_score_to_reuse:
            selected_identity = _create_identity_for_person(db, detection, person, source=source)
            selected_score = 1.0
        else:
            _accept_detection(db, detection, best_identity, best_score, source)
            selected_identity = best_identity
            selected_score = best_score

    # Keep explicit rounded value aligned with existing API responses.
    detection.identity_score = round(selected_score, 6)

    if old_identity_id and old_identity_id != selected_identity.id:
        recalculate_centroid(db, old_identity_id)

    return selected_identity


def match_detections_for_asset(db: Session, asset_id: str | UUID) -> None:
    """Run matching for all fresh (unmatched) detections of an asset."""
    detections = (
        db.query(FaceDetection)
        .filter(
            FaceDetection.asset_id == str(asset_id),
            FaceDetection.identity_id.is_(None),
            FaceDetection.model_identity_id.is_(None),
        )
        .order_by(FaceDetection.face_index)
        .all()
    )

    for det in detections:
        match_detection(db, det)
        db.flush()
