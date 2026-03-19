from pathlib import Path

from PIL import Image
from PIL.ExifTags import TAGS

from app.celery_app import celery
from app.config import settings
from app.database import SessionLocal
import app.users.models
from app.assets.models import Asset, File, AssetVersion


def _extract_exif(img: Image.Image) -> dict | None:
    raw = img.getexif()
    if not raw:
        return None
    result = {}
    for tag_id, value in raw.items():
        tag_name = TAGS.get(tag_id, str(tag_id))
        if isinstance(value, bytes):
            continue
        if isinstance(value, (str, int, float, bool)):
            result[tag_name] = value
        else:
            result[tag_name] = str(value)
    return result or None


@celery.task(name="app.assets.tasks.process_asset")
def process_asset(asset_id: str, file_id: str):
    db = SessionLocal()
    try:
        asset = db.query(Asset).filter_by(id=asset_id).first()
        file_record = db.query(File).filter_by(id=file_id).first()

        if not asset or not file_record:
            return

        file_path = Path(settings.storage_root) / file_record.path

        try:
            with Image.open(file_path) as img:
                file_record.width = img.width
                file_record.height = img.height
                exif_data = _extract_exif(img)

            version = AssetVersion(
                asset_id=asset_id,
                version_number=1,
                recipe={},
                exif_data=exif_data,
                keywords=[],
            )
            db.add(version)
            asset.status = "ready"
            db.commit()
        except Exception:
            db.rollback()
            asset = db.query(Asset).filter_by(id=asset_id).first()
            if asset:
                asset.status = "error"
                db.commit()
            raise
    finally:
        db.close()
