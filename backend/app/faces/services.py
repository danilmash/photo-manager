from __future__ import annotations

from uuid import UUID

import numpy as np
from sqlalchemy.orm import Session

from app.faces.models import FaceDetection, FaceIdentity


def recalculate_centroid(db: Session, identity_id: UUID) -> None:
    """Recompute the L2-normalised centroid embedding for a FaceIdentity
    based on all its linked FaceDetection rows and update samples_count.
    """
    identity = db.query(FaceIdentity).filter_by(id=identity_id).first()
    if not identity:
        return

    detections = (
        db.query(FaceDetection)
        .filter_by(identity_id=identity_id)
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
