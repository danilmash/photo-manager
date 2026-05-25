from __future__ import annotations

from uuid import UUID

from sqlalchemy import distinct, select
from sqlalchemy.orm import Query, Session

from app.assets.models import Asset
from app.faces.models import FaceDetection, FaceIdentity


def apply_person_filter(
    query: Query,
    db: Session,
    *,
    person_id: UUID,
) -> Query:
    del db
    person_asset_ids = (
        select(distinct(FaceDetection.asset_id))
        .join(FaceIdentity, FaceDetection.identity_id == FaceIdentity.id)
        .where(FaceIdentity.person_id == person_id)
    )
    return query.filter(Asset.id.in_(person_asset_ids))
