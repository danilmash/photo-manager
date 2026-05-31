from __future__ import annotations

from datetime import date

from sqlalchemy import String, and_, cast, func
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Query, Session

from app.assets.models import Asset, AssetVersion


def _exif_taken_date_expr(exif_column, other_column):
    exif_raw = func.coalesce(
        exif_column.op("->>")("DateTimeOriginal"),
        exif_column.op("->")("EXIF").op("->>")("DateTimeOriginal"),
        exif_column.op("->")("IFD0").op("->>")("DateTimeOriginal"),
    )
    dng_raw = other_column.op("->>")("dng:create.date")
    raw = func.coalesce(exif_raw, dng_raw)
    normalized = func.replace(
        func.replace(func.substring(raw, 1, 10), ":", "-"),
        "T",
        "-",
    )
    return cast(normalized, String)


def _exif_camera_text_expr(exif_column, other_column):
    make = func.coalesce(
        exif_column.op("->>")("Make"),
        exif_column.op("->")("IFD0").op("->>")("Make"),
        other_column.op("->>")("dng:make"),
        "",
    )
    model = func.coalesce(
        exif_column.op("->>")("Model"),
        exif_column.op("->")("IFD0").op("->>")("Model"),
        other_column.op("->>")("dng:camera.model.name"),
        "",
    )
    return func.lower(func.concat(make, " ", model))


def _latest_version_subquery(db: Session):
    return (
        db.query(
            AssetVersion.asset_id.label("asset_id"),
            func.max(AssetVersion.version_number).label("max_version_number"),
        )
        .group_by(AssetVersion.asset_id)
        .subquery()
    )


def apply_metadata_filters(
    db: Session,
    query: Query,
    *,
    tags: list[str] | None = None,
    taken_from: date | None = None,
    taken_to: date | None = None,
    camera: str | None = None,
) -> Query:
    has_tags = bool(tags)
    has_date = taken_from is not None or taken_to is not None
    has_camera = bool(camera and camera.strip())

    if not (has_tags or has_date or has_camera):
        return query

    latest_sq = _latest_version_subquery(db)
    query = query.join(AssetVersion, Asset.id == AssetVersion.asset_id).join(
        latest_sq,
        and_(
            AssetVersion.asset_id == latest_sq.c.asset_id,
            AssetVersion.version_number == latest_sq.c.max_version_number,
        ),
    )

    if has_tags:
        query = query.filter(
            AssetVersion.keywords.op("?|")(cast(tags, ARRAY(String)))
        )

    if has_date:
        taken_date_expr = _exif_taken_date_expr(AssetVersion.exif, AssetVersion.other)
        if taken_from is not None:
            query = query.filter(taken_date_expr >= taken_from.isoformat())
        if taken_to is not None:
            query = query.filter(taken_date_expr <= taken_to.isoformat())

    if has_camera:
        needle = camera.strip().lower()
        camera_expr = _exif_camera_text_expr(AssetVersion.exif, AssetVersion.other)
        query = query.filter(camera_expr.contains(needle))

    return query


def collect_distinct_tags(
    db: Session,
    *,
    asset_query: Query,
    prefix: str | None = None,
    limit: int = 20,
) -> list[str]:
    latest_sq = _latest_version_subquery(db)
    keywords_rows = (
        asset_query.join(AssetVersion, Asset.id == AssetVersion.asset_id)
        .join(
            latest_sq,
            and_(
                AssetVersion.asset_id == latest_sq.c.asset_id,
                AssetVersion.version_number == latest_sq.c.max_version_number,
            ),
        )
        .with_entities(AssetVersion.keywords)
        .all()
    )

    prefix_fold = prefix.casefold().strip() if prefix else None
    tags: set[str] = set()
    for (keywords,) in keywords_rows:
        if not isinstance(keywords, list):
            continue
        for item in keywords:
            if not isinstance(item, str):
                continue
            tag = item.strip()
            if not tag:
                continue
            if prefix_fold and not tag.casefold().startswith(prefix_fold):
                continue
            tags.add(tag)

    return sorted(tags, key=lambda value: value.casefold())[:limit]
