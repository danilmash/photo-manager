import datetime
import uuid
from pathlib import Path

from app.faces.models import FaceDetection
from app.assets.ml_service import detect_faces
from wand.image import Image

from app.celery_app import celery
from app.config import settings
from app.database import SessionLocal
import app.users.models
from app.assets.models import Asset, File, AssetVersion

PREVIEW_SPECS = [
    {"purpose": "thumbnail", "long_side": 300,  "quality": 80, "subdir": "thumbnails"},
    {"purpose": "preview",   "long_side": 1200, "quality": 85, "subdir": "previews"},
]


def _json_safe(value):
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    return str(value)


def _extract_metadata(img: Image) -> dict | None:
    exif: dict = {}
    iptc: dict = {}
    xmp: dict = {}
    other: dict = {}
    for key, value in img.metadata.items():
        safe = _json_safe(value)
        if key.startswith("exif:"):
            exif[key[5:]] = safe
        elif key.startswith("iptc:"):
            iptc[key[5:]] = safe
        elif key.startswith("xmp:"):
            xmp[key[4:]] = safe
        else:
            other[key] = safe
    out: dict = {}
    if exif:
        out["exif"] = exif
    if iptc:
        out["iptc"] = iptc
    if xmp:
        out["xmp"] = xmp
    if other:
        out["other"] = other
    return out or None


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

def _save_face_detections(db, asset_id: str, preview_path: Path):
    """Отправляет превью в ml сервис и сохраняет найденные лица"""
    try:
        faces = detect_faces(str(preview_path))
    except Exception as e:
        # ml сервис недоступен — не падаем, просто пропускаем
        print(f"[faces] ml сервис недоступен: {e}")
        return

    for face in faces:
        # Пропускаем лица с низкой уверенностью
        if face["confidence"] < 0.7:
            continue

        db.add(FaceDetection(
            asset_id=asset_id,
            bbox=face["bbox"],
            embedding=face["embedding"],
            confidence=face["confidence"],
            created_at=datetime.datetime.now(),
        ))

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
        preview_path = None  # путь к превью для ml

        try:
            with Image(filename=str(file_path)) as img:
                file_record.width = img.width
                file_record.height = img.height
                meta = _extract_metadata(img) or {}
                exif = meta.get("exif") if isinstance(meta.get("exif"), dict) else None
                iptc = meta.get("iptc") if isinstance(meta.get("iptc"), dict) else None
                xmp = meta.get("xmp") if isinstance(meta.get("xmp"), dict) else None
                other = meta.get("other") if isinstance(meta.get("other"), dict) else None

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

                    # Запоминаем путь к большому превью для ml
                    if spec["purpose"] == "preview":
                        preview_path = dest

            version = AssetVersion(
                asset_id=asset_id,
                version_number=1,
                recipe={},
                exif=exif,
                iptc=iptc,
                xmp=xmp,
                other=other,
                keywords=[],
            )
            db.add(version)
            db.flush()

            # Детекция лиц — используем превью а не оригинал
            # превью достаточно по качеству и намного меньше по размеру
            if preview_path and preview_path.exists():
                _save_face_detections(db, asset_id, preview_path)

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
