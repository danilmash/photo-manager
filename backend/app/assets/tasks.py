import datetime
import uuid
from pathlib import Path

from sqlalchemy import func
from wand.image import Image

from app.assets.ml_service import detect_faces
from app.assets.models import (
    ASSET_STATUS_ERROR,
    ASSET_STATUS_PARTIAL_ERROR,
    ASSET_STATUS_READY,
    TASK_STATUS_COMPLETED,
    TASK_STATUS_FAILED,
    TASK_STATUS_PROCESSING,
    apply_asset_status,
    Asset,
    AssetVersion,
    File,
)
from app.celery_app import celery
from app.config import settings
from app.database import SessionLocal
from app.faces.models import FaceDetection
from app.faces.services import match_detections_for_asset
from app.import_batches.models import (
    IMPORT_BATCH_STATUS_PENDING_REVIEW,
    IMPORT_BATCH_STATUS_PROCESSING,
    ImportBatch,
)
import app.users.models  # noqa: F401 — регистрация модели для relationships


# Максимальная длина текста ошибки, которую сохраняем в preview_error/faces_error.
# Ограничиваем, чтобы случайный traceback не распухал до мегабайтов в БД.
ERROR_TEXT_LIMIT = 2000

FACE_CONFIDENCE_THRESHOLD = 0.3

def _truncate_error(exc: BaseException) -> str:
    text = str(exc) or exc.__class__.__name__
    if len(text) > ERROR_TEXT_LIMIT:
        text = text[:ERROR_TEXT_LIMIT]
    return text

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


def _generate_face_crops(db, asset_id: str, preview_path: Path):
    """Crop each detected face from the preview and save as a 256x256 JPEG."""
    with Image(filename=str(preview_path)) as img:
        w_img, h_img = img.width, img.height

        detections = (
            db.query(FaceDetection)
            .filter_by(asset_id=asset_id)
            .filter(FaceDetection.crop_path.is_(None))
            .all()
        )

        for det in detections:
            bbox = det.bbox
            px_x = int(bbox["x"] * w_img)
            px_y = int(bbox["y"] * h_img)
            px_w = int(bbox["w"] * w_img)
            px_h = int(bbox["h"] * h_img)

            pad = int(max(px_w, px_h) * 0.2)
            left = max(px_x - pad, 0)
            top = max(px_y - pad, 0)
            crop_w = min(px_x + px_w + pad, w_img) - left
            crop_h = min(px_y + px_h + pad, h_img) - top

            with img.clone() as crop:
                crop.crop(left, top, width=crop_w, height=crop_h)

                side = max(crop.width, crop.height)
                crop.gravity = "center"
                crop.extent(side, side)

                crop.resize(256, 256)
                crop.format = "jpeg"
                crop.compression_quality = 90

                rel_path = f"crops/{asset_id}/{det.id}.jpg"
                dest = Path(settings.storage_root) / rel_path
                dest.parent.mkdir(parents=True, exist_ok=True)
                crop.save(filename=str(dest))

                det.crop_path = rel_path


def _save_face_detections(db, asset_id: str, preview_path: Path):
    """Отправляет превью в ml сервис и сохраняет найденные лица."""
    try:
        faces = detect_faces(str(preview_path))
    except Exception as e:
        print(f"[faces] ml сервис недоступен: {e}")
        return

    for face in faces:
        if face["confidence"] < FACE_CONFIDENCE_THRESHOLD:
            continue

        bbox = face.get("bbox") or {}
        x = float(bbox.get("x", 0.0))
        y = float(bbox.get("y", 0.0))
        w = float(bbox.get("w", 0.0))
        h = float(bbox.get("h", 0.0))
        # Backend safety net against ML full-frame fallback bbox.
        if x <= 0.001 and y <= 0.001 and w >= 0.998 and h >= 0.998:
            continue

        if not (0.0 <= x <= 1.0 and 0.0 <= y <= 1.0 and 0.0 < w <= 1.0 and 0.0 < h <= 1.0):
            continue

        db.add(FaceDetection(
            asset_id=asset_id,
            face_index=face["face_index"],
            bbox=bbox,
            embedding=face["embedding"],
            confidence=face["confidence"],
            quality_score=face.get("quality_score"),
            is_reference=False,
            created_at=datetime.datetime.now(),
        ))


def _finalize_batch_if_done(db, batch_id) -> None:
    """Переводит партию в pending_review, когда все её ассеты финализированы.

    Финальные статусы ассета: ready / partial_error / error. Вызывается в
    finally у process_asset_ml. Операция идемпотентна: если партия уже не в
    статусе `processing`, ничего не делает.
    """
    if batch_id is None:
        return

    batch = db.query(ImportBatch).filter_by(id=batch_id).first()
    if not batch or batch.status != IMPORT_BATCH_STATUS_PROCESSING:
        return

    remaining = (
        db.query(func.count(Asset.id))
        .filter(Asset.import_batch_id == batch_id)
        .filter(
            Asset.status.notin_(
                [ASSET_STATUS_READY, ASSET_STATUS_PARTIAL_ERROR, ASSET_STATUS_ERROR]
            )
        )
        .scalar()
        or 0
    )
    if remaining == 0:
        batch.status = IMPORT_BATCH_STATUS_PENDING_REVIEW
        db.add(batch)
        db.commit()


@celery.task(name="app.assets.tasks.process_asset_preview")
def process_asset_preview(asset_id: str, file_id: str):
    """Фаза 1 — дешёвая: метаданные, thumbnail, preview.

    Управляет только preview_status / preview_error, общий asset.status
    пересчитывается из derive_asset_status.
    """
    db = SessionLocal()
    try:
        asset = db.query(Asset).filter_by(id=asset_id).first()
        file_record = db.query(File).filter_by(id=file_id).first()

        if not asset or not file_record:
            return

        # Отмечаем, что фаза пошла в работу. Коммитим сразу, чтобы клиент
        # видел processing в API до окончания тяжёлой работы.
        asset.preview_status = TASK_STATUS_PROCESSING
        asset.preview_error = None
        apply_asset_status(asset)
        db.commit()

        file_path = Path(settings.storage_root) / file_record.path
        storage = Path(settings.storage_root)

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

            asset.preview_status = TASK_STATUS_COMPLETED
            asset.preview_error = None
            apply_asset_status(asset)
            db.commit()
        except Exception as exc:
            db.rollback()
            asset = db.query(Asset).filter_by(id=asset_id).first()
            if asset:
                asset.preview_status = TASK_STATUS_FAILED
                asset.preview_error = _truncate_error(exc)
                apply_asset_status(asset)
                db.commit()
            raise
    finally:
        db.close()


@celery.task(name="app.assets.tasks.process_asset_ml")
def process_asset_ml(asset_id: str):
    """Фаза 2 — дорогая: детекция лиц, кропы, матчинг identity.

    Управляет только faces_status / faces_error. Исключения внутри фазы
    ловим и не пробрасываем наружу: faces — необязательная фаза, общий
    статус ассета станет partial_error, а финализация партии обязательно
    сработает в finally.
    """
    db = SessionLocal()
    batch_id = None
    try:
        try:
            asset_uuid = uuid.UUID(asset_id)
        except ValueError:
            return

        asset = db.query(Asset).filter_by(id=asset_uuid).first()
        if not asset:
            return

        batch_id = asset.import_batch_id

        preview_file = (
            db.query(File)
            .filter_by(asset_id=asset.id, purpose="preview")
            .order_by(File.created_at.desc())
            .first()
        )

        def _fail(reason: str) -> None:
            asset.faces_status = TASK_STATUS_FAILED
            asset.faces_error = reason[:ERROR_TEXT_LIMIT]
            apply_asset_status(asset)
            db.commit()

        if not preview_file:
            _fail("Превью не найдено: нечего обрабатывать ML")
            return

        preview_path = Path(settings.storage_root) / preview_file.path
        if not preview_path.exists():
            _fail(f"Файл превью отсутствует на диске: {preview_file.path}")
            return

        asset.faces_status = TASK_STATUS_PROCESSING
        asset.faces_error = None
        apply_asset_status(asset)
        db.commit()

        try:
            # Make ML reruns idempotent: keep only fresh detections for this asset.
            db.query(FaceDetection).filter_by(asset_id=asset.id).delete()
            db.flush()

            _save_face_detections(db, str(asset.id), preview_path)
            db.flush()
            _generate_face_crops(db, str(asset.id), preview_path)
            match_detections_for_asset(db, asset.id)

            asset.faces_status = TASK_STATUS_COMPLETED
            asset.faces_error = None
            apply_asset_status(asset)
            db.commit()
        except Exception as exc:
            db.rollback()
            asset = db.query(Asset).filter_by(id=asset_uuid).first()
            if asset:
                asset.faces_status = TASK_STATUS_FAILED
                asset.faces_error = _truncate_error(exc)
                apply_asset_status(asset)
                db.commit()
            # Сознательно глотаем исключение: faces — опциональная фаза,
            # общий статус ассета теперь partial_error. Пробрасывать наверх
            # не надо, иначе celery пометит задачу как failed и финализация
            # батча может не дождаться своих "ответов".
    finally:
        try:
            _finalize_batch_if_done(db, batch_id)
        finally:
            db.close()
