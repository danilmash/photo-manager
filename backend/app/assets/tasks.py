import uuid
from pathlib import Path

from wand.image import Image

from app.celery_app import celery
from app.config import settings
from app.database import SessionLocal
import app.users.models  # noqa: F401
from app.assets.models import Asset, File, AssetVersion

PREVIEW_SPECS = [
    {"purpose": "thumbnail", "long_side": 300,  "quality": 80, "subdir": "thumbnails"},
    {"purpose": "preview",   "long_side": 1200, "quality": 85, "subdir": "previews"},
]


def _extract_exif(img: Image) -> dict | None:
    result = {}
    for key, value in img.metadata.items():
        if key.startswith("exif:"):
            tag = key[len("exif:"):]
            result[tag] = value
    return result or None


def _generate_preview(img: Image, *, long_side: int, quality: int, dest: Path):
    with img.clone() as copy:
        w, h = copy.width, copy.height
        if max(w, h) > long_side:
            if w >= h:
                copy.transform(resize=f"{long_side}x")
            else:
                copy.transform(resize=f"x{long_side}")
        copy.format = "jpeg"
        copy.compression_quality = quality
        dest.parent.mkdir(parents=True, exist_ok=True)
        copy.save(filename=str(dest))


@celery.task(name="app.assets.tasks.process_asset")
def process_asset(asset_id: str, file_id: str):
    db = SessionLocal()
    try:
        asset = db.query(Asset).filter_by(id=asset_id).first()
        file_record = db.query(File).filter_by(id=file_id).first()

        if not asset or not file_record:
            return

        file_path = Path(settings.storage_root) / file_record.path
        storage = Path(settings.storage_root)

        try:
            with Image(filename=str(file_path)) as img:
                file_record.width = img.width
                file_record.height = img.height
                exif_data = _extract_exif(img)

                for spec in PREVIEW_SPECS:
                    preview_filename = f"{spec['purpose']}.jpg"
                    preview_dir = storage / spec["subdir"] / asset_id
                    dest = preview_dir / preview_filename
                    _generate_preview(
                        img,
                        long_side=spec["long_side"],
                        quality=spec["quality"],
                        dest=dest,
                    )

                    preview_stat = dest.stat()
                    with Image(filename=str(dest)) as preview_img:
                        pw, ph = preview_img.width, preview_img.height

                    db.add(File(
                        id=uuid.uuid4(),
                        asset_id=asset_id,
                        filename=preview_filename,
                        mime_type="image/jpeg",
                        width=pw,
                        height=ph,
                        size_bytes=preview_stat.st_size,
                        path=f"{spec['subdir']}/{asset_id}/{preview_filename}",
                        purpose=spec["purpose"],
                    ))

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
