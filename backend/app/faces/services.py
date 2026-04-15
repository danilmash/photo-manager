from __future__ import annotations

from uuid import UUID

import numpy as np
from sqlalchemy.orm import Session

from app.faces.models import FaceCandidate, FaceDetection, FaceIdentity

MATCH_SCORE_THRESHOLD = 0.55
MATCH_MARGIN_THRESHOLD = 0.10
MAX_CANDIDATES = 5


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

    detection.model_identity_id = best_identity.id
    detection.model_identity_score = round(best_score, 6)
    detection.model_identity_margin = round(margin, 6)

    if best_score >= MATCH_SCORE_THRESHOLD and margin >= MATCH_MARGIN_THRESHOLD:
        _accept_detection(db, detection, best_identity, best_score, "model")
    else:
        if best_score < MATCH_SCORE_THRESHOLD:
            _create_new_identity(db, detection)


def _create_new_identity(db: Session, detection: FaceDetection) -> FaceIdentity:
    """Bootstrap a new FaceIdentity from a single detection."""
    emb = list(detection.embedding)
    arr = np.array(emb, dtype=np.float64)
    norm = np.linalg.norm(arr)
    if norm > 0:
        arr = arr / norm

    identity = FaceIdentity(
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

    return identity


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
