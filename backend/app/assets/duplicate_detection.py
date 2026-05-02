"""Вычисление хешей и поиск дубликатов внутри партии импорта."""

from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path

from sqlalchemy import and_, func
from sqlalchemy.orm import Session
from wand.image import Image

from app.assets.models import (
    DUPLICATE_REVIEW_HAS_DUPLICATES,
    DUPLICATE_REVIEW_NO_DUPLICATES,
    DUPLICATE_REVIEW_PENDING,
    DUPLICATE_REVIEW_REVIEWED,
    DUPLICATE_TYPE_EXACT,
    DUPLICATE_TYPE_NEAR,
    DUPLICATE_TYPE_VISUAL,
    ASSET_LIFECYCLE_ACTIVE,
    Asset,
    AssetDuplicateCandidate,
    AssetVersion,
    TASK_STATUS_COMPLETED,
    TASK_STATUS_FAILED,
)


PHASH_MAX_DISTANCE = 12
DHASH_MAX_DISTANCE = 14


def compute_original_hashes(
    file_path: Path,
    oriented_img: Image,
) -> tuple[str | None, str | None, str | None]:
    """SHA256 файла на диске; phash/dhash по уже ориентированному изображению Wand."""
    sha256_hex: str | None = None
    try:
        digest = hashlib.sha256()
        with open(file_path, "rb") as fh:
            for chunk in iter(lambda: fh.read(1024 * 1024), b""):
                digest.update(chunk)
        sha256_hex = digest.hexdigest()
    except OSError:
        pass

    phash_hex: str | None = None
    dhash_hex: str | None = None
    try:
        import imagehash
        from PIL import Image as PILImage

        with oriented_img.clone() as clone:
            clone.format = "png"
            blob = clone.make_blob()
        pil_img = PILImage.open(BytesIO(blob)).convert("RGB")
        phash_hex = str(imagehash.phash(pil_img))
        dhash_hex = str(imagehash.dhash(pil_img))
    except Exception:
        pass

    return sha256_hex, phash_hex, dhash_hex


def _latest_versions_sq(db: Session, batch_id: uuid.UUID):
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


def batch_previews_all_terminal(db: Session, batch_id: uuid.UUID) -> bool:
    """Все активные ассеты партии имеют финальный статус превью (успех или ошибка)."""
    total = (
        db.query(func.count(Asset.id))
        .filter(
            Asset.import_batch_id == batch_id,
            Asset.lifecycle_status == ASSET_LIFECYCLE_ACTIVE,
        )
        .scalar()
        or 0
    )
    if total == 0:
        return False

    latest_sq = _latest_versions_sq(db, batch_id)
    terminal = (
        db.query(func.count(AssetVersion.id))
        .join(
            latest_sq,
            and_(
                AssetVersion.asset_id == latest_sq.c.asset_id,
                AssetVersion.version_number == latest_sq.c.max_version_number,
            ),
        )
        .filter(
            AssetVersion.preview_status.in_(
                (TASK_STATUS_COMPLETED, TASK_STATUS_FAILED),
            ),
        )
        .scalar()
        or 0
    )
    return terminal == total


@dataclass(frozen=True)
class _Match:
    candidate_id: uuid.UUID
    duplicate_type: str
    distance: int
    score: float


def _compare_versions(source: AssetVersion, other: AssetVersion) -> _Match | None:
    if source.sha256 and other.sha256 and source.sha256 == other.sha256:
        return _Match(other.asset_id, DUPLICATE_TYPE_EXACT, 0, 1.0)

    if source.phash and other.phash:
        try:
            import imagehash

            h1 = imagehash.hex_to_hash(source.phash)
            h2 = imagehash.hex_to_hash(other.phash)
            dist = h1 - h2
            if dist <= PHASH_MAX_DISTANCE:
                score = max(0.0, 1.0 - dist / 64.0)
                return _Match(other.asset_id, DUPLICATE_TYPE_VISUAL, dist, score)
        except Exception:
            pass

    if source.dhash and other.dhash:
        try:
            import imagehash

            h1 = imagehash.hex_to_hash(source.dhash)
            h2 = imagehash.hex_to_hash(other.dhash)
            dist = h1 - h2
            if dist <= DHASH_MAX_DISTANCE:
                score = max(0.0, 1.0 - dist / 64.0)
                return _Match(other.asset_id, DUPLICATE_TYPE_NEAR, dist, score)
        except Exception:
            pass

    return None


def run_duplicate_scan_for_batch(db: Session, batch_id: uuid.UUID) -> None:
    batch_assets = (
        db.query(Asset)
        .filter(
            Asset.import_batch_id == batch_id,
            Asset.lifecycle_status == ASSET_LIFECYCLE_ACTIVE,
        )
        .all()
    )
    asset_ids = [a.id for a in batch_assets]
    asset_by_id = {a.id: a for a in batch_assets}

    db.query(AssetDuplicateCandidate).filter(
        AssetDuplicateCandidate.source_asset_id.in_(asset_ids),
        AssetDuplicateCandidate.candidate_asset_id.in_(asset_ids),
        AssetDuplicateCandidate.review_decision.is_(None),
    ).delete(synchronize_session=False)

    locked_pairs = {
        (r.source_asset_id, r.candidate_asset_id)
        for r in db.query(AssetDuplicateCandidate).filter(
            AssetDuplicateCandidate.source_asset_id.in_(asset_ids),
            AssetDuplicateCandidate.candidate_asset_id.in_(asset_ids),
        ).all()
    }

    for asset in batch_assets:
        if asset.duplicate_review_status == DUPLICATE_REVIEW_REVIEWED:
            continue
        asset.duplicate_of_asset_id = None
        asset.duplicate_review_status = DUPLICATE_REVIEW_PENDING

    latest_sq = _latest_versions_sq(db, batch_id)
    eligible_versions = (
        db.query(AssetVersion)
        .join(
            Asset,
            and_(
                Asset.id == AssetVersion.asset_id,
                Asset.import_batch_id == batch_id,
                Asset.lifecycle_status == ASSET_LIFECYCLE_ACTIVE,
            ),
        )
        .join(
            latest_sq,
            and_(
                AssetVersion.asset_id == latest_sq.c.asset_id,
                AssetVersion.version_number == latest_sq.c.max_version_number,
            ),
        )
        .filter(AssetVersion.preview_status == TASK_STATUS_COMPLETED)
        .filter(AssetVersion.sha256.isnot(None))
        .order_by(Asset.created_at.asc(), Asset.id.asc())
        .all()
    )

    versions_map = {v.asset_id: v for v in eligible_versions}
    ordered_ids = list(versions_map.keys())

    if len(ordered_ids) < 2:
        for asset in batch_assets:
            if asset.duplicate_review_status == DUPLICATE_REVIEW_REVIEWED:
                continue
            aid = asset.id
            if any(sa == aid or ca == aid for sa, ca in locked_pairs):
                asset.duplicate_review_status = DUPLICATE_REVIEW_HAS_DUPLICATES
            else:
                asset.duplicate_review_status = DUPLICATE_REVIEW_NO_DUPLICATES
        db.commit()
        return

    sources_pool = set(ordered_ids)
    involved: set[uuid.UUID] = set()
    rows: list[AssetDuplicateCandidate] = []

    for sa, ca in locked_pairs:
        involved.add(sa)
        involved.add(ca)

    for _, ca in locked_pairs:
        sources_pool.discard(ca)

    for source_id in ordered_ids:
        if source_id not in sources_pool:
            continue
        sv = versions_map[source_id]
        matches: list[_Match] = []
        for other_id in ordered_ids:
            if other_id == source_id or other_id not in sources_pool:
                continue
            ov = versions_map[other_id]
            m = _compare_versions(sv, ov)
            if m:
                matches.append(m)

        matches.sort(key=lambda m: (-m.score, m.distance))
        new_matches = [
            m
            for m in matches
            if (source_id, m.candidate_id) not in locked_pairs
        ]
        if new_matches:
            for rank, m in enumerate(new_matches, start=1):
                rows.append(
                    AssetDuplicateCandidate(
                        source_asset_id=source_id,
                        candidate_asset_id=m.candidate_id,
                        duplicate_type=m.duplicate_type,
                        score=m.score,
                        distance=m.distance,
                        rank=rank,
                        review_decision=None,
                        reviewed_at=None,
                        reviewed_by_user_id=None,
                    ),
                )
                locked_pairs.add((source_id, m.candidate_id))
                sources_pool.discard(m.candidate_id)
                involved.add(source_id)
                involved.add(m.candidate_id)

    for row in rows:
        db.add(row)

    for aid in ordered_ids:
        asset = asset_by_id.get(aid)
        if asset and asset.duplicate_review_status != DUPLICATE_REVIEW_REVIEWED:
            asset.duplicate_review_status = (
                DUPLICATE_REVIEW_HAS_DUPLICATES
                if aid in involved
                else DUPLICATE_REVIEW_NO_DUPLICATES
            )

    for asset in batch_assets:
        if asset.duplicate_review_status == DUPLICATE_REVIEW_REVIEWED:
            continue
        if asset.id not in ordered_ids:
            asset.duplicate_review_status = DUPLICATE_REVIEW_NO_DUPLICATES

    db.commit()
