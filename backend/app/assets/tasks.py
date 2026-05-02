import datetime
import uuid
from pathlib import Path

from sqlalchemy import and_, func
from wand.color import Color
from wand.image import Image

from app.assets.ml_service import detect_faces
from app.assets.duplicate_detection import (
    batch_previews_all_terminal,
    compute_original_hashes,
    run_duplicate_scan_for_batch,
)
from app.assets.models import (
    ASSET_LIFECYCLE_ACTIVE,
    TASK_STATUS_COMPLETED,
    TASK_STATUS_FAILED,
    TASK_STATUS_PENDING,
    TASK_STATUS_PROCESSING,
    VERSION_STATUS_ERROR,
    VERSION_STATUS_PARTIAL_ERROR,
    VERSION_STATUS_READY,
    Asset,
    AssetVersion,
    File,
    apply_version_status,
)
from app.assets.recipes import normalize_recipe
from app.celery_app import celery
from app.config import settings
from app.database import SessionLocal
from app.faces.models import FaceDetection
from app.faces.services import (
    match_detections_for_version,
    promote_identity_source_version,
    transfer_user_assignments_from_base_version,
)
from app.import_batches.models import (
    IMPORT_BATCH_STATUS_PENDING_REVIEW,
    IMPORT_BATCH_STATUS_PROCESSING,
    IMPORT_BATCH_STATUS_UPLOADING,
    ImportBatch,
)
import app.users.models  # noqa: F401


ERROR_TEXT_LIMIT = 2000
FACE_CONFIDENCE_THRESHOLD = 0.3

PREVIEW_SPECS = [
    {"purpose": "thumbnail", "long_side": 300, "quality": 80, "subdir": "thumbnails"},
    {"purpose": "preview", "long_side": 1200, "quality": 85, "subdir": "previews"},
]


def _truncate_error(exc: BaseException) -> str:
    text = str(exc) or exc.__class__.__name__
    if len(text) > ERROR_TEXT_LIMIT:
        text = text[:ERROR_TEXT_LIMIT]
    return text


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


def _apply_channel_shift(img: Image, channel: str, delta: float) -> None:
    if delta > 0:
        img.evaluate(operator="add", value=delta, channel=channel)
    elif delta < 0:
        img.evaluate(operator="subtract", value=abs(delta), channel=channel)


def _apply_recipe(img: Image, recipe: dict) -> None:
    if recipe["flip_horizontal"]:
        img.flop()
    if recipe["flip_vertical"]:
        img.flip()

    rotation_degrees = float(recipe["rotation_degrees"])
    if abs(rotation_degrees) > 0.001:
        img.rotate(rotation_degrees, background=Color("black"))

    crop = recipe["crop"]
    if crop["x"] > 0 or crop["y"] > 0 or crop["w"] < 1 or crop["h"] < 1:
        left = int(round(img.width * crop["x"]))
        top = int(round(img.height * crop["y"]))
        width = max(1, int(round(img.width * crop["w"])))
        height = max(1, int(round(img.height * crop["h"])))
        left = max(0, min(left, max(img.width - 1, 0)))
        top = max(0, min(top, max(img.height - 1, 0)))
        width = max(1, min(width, img.width - left))
        height = max(1, min(height, img.height - top))
        img.crop(left=left, top=top, width=width, height=height, reset_coords=True)

    exposure = float(recipe["exposure"])
    saturation = float(recipe["saturation"])
    if exposure != 0 or saturation != 0:
        img.modulate(
            brightness=max(0.0, 100.0 + exposure),
            saturation=max(0.0, 100.0 + saturation),
            hue=100.0,
        )

    contrast = float(recipe["contrast"])
    if contrast != 0:
        img.brightness_contrast(brightness=0.0, contrast=contrast)

    quantum_range = float(img.quantum_range)

    shadows = float(recipe["shadows"])
    if shadows != 0:
        img.sigmoidal_contrast(
            sharpen=shadows < 0,
            strength=max(0.1, abs(shadows) / 20.0),
            midpoint=0.25 * quantum_range,
        )

    highlights = float(recipe["highlights"])
    if highlights != 0:
        img.sigmoidal_contrast(
            sharpen=highlights < 0,
            strength=max(0.1, abs(highlights) / 20.0),
            midpoint=0.75 * quantum_range,
        )

    temperature = float(recipe["temperature"])
    if temperature != 0:
        delta = quantum_range * (abs(temperature) / 100.0) * 0.06
        if temperature > 0:
            _apply_channel_shift(img, "red", delta)
            _apply_channel_shift(img, "blue", -delta)
        else:
            _apply_channel_shift(img, "red", -delta)
            _apply_channel_shift(img, "blue", delta)

    tint = float(recipe["tint"])
    if tint != 0:
        delta = quantum_range * (abs(tint) / 100.0) * 0.05
        # Positive values push towards magenta, negative values towards green.
        _apply_channel_shift(img, "green", -delta if tint > 0 else delta)

    sharpness = float(recipe["sharpness"])
    if sharpness > 0:
        img.sharpen(radius=0.0, sigma=max(0.1, 0.5 + sharpness / 40.0))

    vignette = float(recipe["vignette"])
    if vignette > 0:
        sigma = max(img.width, img.height) * (vignette / 100.0) * 0.12
        img.vignette(
            radius=0.0,
            sigma=max(1.0, sigma),
            x=int(img.width * 0.08),
            y=int(img.height * 0.08),
        )

    img.clamp()


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


def _upsert_version_file(
    db,
    *,
    version: AssetVersion,
    purpose: str,
    filename: str,
    path: str,
    width: int,
    height: int,
    size_bytes: int,
    mime_type: str = "image/jpeg",
) -> None:
    file_record = (
        db.query(File)
        .filter_by(asset_version_id=version.id, purpose=purpose)
        .first()
    )
    if not file_record:
        file_record = File(
            id=uuid.uuid4(),
            asset_id=version.asset_id,
            asset_version_id=version.id,
            purpose=purpose,
            filename=filename,
            mime_type=mime_type,
            size_bytes=size_bytes,
            path=path,
            width=width,
            height=height,
        )
        db.add(file_record)
        return

    file_record.filename = filename
    file_record.mime_type = mime_type
    file_record.path = path
    file_record.size_bytes = size_bytes
    file_record.width = width
    file_record.height = height


def _get_original_file(db, asset_id: uuid.UUID) -> File | None:
    return (
        db.query(File)
        .filter_by(asset_id=asset_id, purpose="original")
        .order_by(File.created_at.desc())
        .first()
    )


def _generate_face_crops(db, version: AssetVersion, preview_path: Path):
    with Image(filename=str(preview_path)) as img:
        w_img, h_img = img.width, img.height

        detections = (
            db.query(FaceDetection)
            .filter_by(asset_version_id=version.id)
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
            face_left = max(px_x - pad, 0)
            face_top = max(px_y - pad, 0)
            face_right = min(px_x + px_w + pad, w_img)
            face_bottom = min(px_y + px_h + pad, h_img)
            crop_w = max(face_right - face_left, 1)
            crop_h = max(face_bottom - face_top, 1)

            side = min(max(crop_w, crop_h), w_img, h_img)
            center_x = face_left + crop_w / 2
            center_y = face_top + crop_h / 2
            left = int(round(center_x - side / 2))
            top = int(round(center_y - side / 2))
            left = max(0, min(left, w_img - side))
            top = max(0, min(top, h_img - side))

            with img.clone() as crop:
                crop.crop(left, top, width=side, height=side)
                crop.resize(256, 256)
                crop.format = "jpeg"
                crop.compression_quality = 90

                rel_path = (
                    f"crops/{version.asset_id}/v{version.version_number}/{det.id}.jpg"
                )
                dest = Path(settings.storage_root) / rel_path
                dest.parent.mkdir(parents=True, exist_ok=True)
                crop.save(filename=str(dest))

                det.crop_path = rel_path


def _save_face_detections(db, version: AssetVersion, preview_path: Path):
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
        if x <= 0.001 and y <= 0.001 and w >= 0.998 and h >= 0.998:
            continue
        if not (0.0 <= x <= 1.0 and 0.0 <= y <= 1.0 and 0.0 < w <= 1.0 and 0.0 < h <= 1.0):
            continue

        db.add(
            FaceDetection(
                asset_id=version.asset_id,
                asset_version_id=version.id,
                face_index=face["face_index"],
                bbox=bbox,
                embedding=face["embedding"],
                confidence=face["confidence"],
                quality_score=face.get("quality_score"),
                is_reference=False,
                created_at=datetime.datetime.now(),
            )
        )


def _latest_versions_query(db, batch_id):
    latest_sq = (
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
    return (
        db.query(AssetVersion)
        .join(
            latest_sq,
            and_(
                AssetVersion.asset_id == latest_sq.c.asset_id,
                AssetVersion.version_number == latest_sq.c.max_version_number,
            ),
        )
    )


def _finalize_batch_if_done(db, batch_id) -> None:
    if batch_id is None:
        return

    batch = db.query(ImportBatch).filter_by(id=batch_id).first()
    if not batch or batch.status != IMPORT_BATCH_STATUS_PROCESSING:
        return

    terminal_statuses = {
        VERSION_STATUS_READY,
        VERSION_STATUS_PARTIAL_ERROR,
        VERSION_STATUS_ERROR,
    }
    remaining = sum(
        1
        for version in _latest_versions_query(db, batch_id).all()
        if version.status not in terminal_statuses
    )
    if remaining == 0:
        batch.status = IMPORT_BATCH_STATUS_PENDING_REVIEW
        db.add(batch)
        db.commit()


@celery.task(name="app.assets.tasks.scan_import_batch_duplicates")
def scan_import_batch_duplicates(batch_id: str) -> None:
    try:
        bid = uuid.UUID(batch_id)
    except ValueError:
        return
    db = SessionLocal()
    try:
        run_duplicate_scan_for_batch(db, bid)
    finally:
        db.close()


@celery.task(name="app.assets.tasks.process_asset_preview")
def process_asset_preview(version_id: str):
    db = SessionLocal()
    try:
        try:
            version_uuid = uuid.UUID(version_id)
        except ValueError:
            return

        version = db.query(AssetVersion).filter_by(id=version_uuid).first()
        if not version:
            return

        asset = db.query(Asset).filter_by(id=version.asset_id).first()
        if not asset:
            return

        if asset.lifecycle_status != ASSET_LIFECYCLE_ACTIVE:
            return

        original_file = _get_original_file(db, asset.id)
        if not original_file:
            version.preview_status = TASK_STATUS_FAILED
            version.preview_error = "Оригинальный файл не найден"
            apply_version_status(version)
            db.commit()
            return

        version.preview_status = TASK_STATUS_PROCESSING
        version.preview_error = None
        apply_version_status(version)
        db.commit()

        file_path = Path(settings.storage_root) / original_file.path
        storage = Path(settings.storage_root)

        try:
            with Image(filename=str(file_path)) as img:
                img.auto_orient()
                original_file.width = img.width
                original_file.height = img.height

                sha256_hex, phash_hex, dhash_hex = compute_original_hashes(file_path, img)
                version.sha256 = sha256_hex
                version.phash = phash_hex
                version.dhash = dhash_hex

                meta = _extract_metadata(img) or {}
                if version.exif is None and isinstance(meta.get("exif"), dict):
                    version.exif = meta.get("exif")
                if version.iptc is None and isinstance(meta.get("iptc"), dict):
                    version.iptc = meta.get("iptc")
                if version.xmp is None and isinstance(meta.get("xmp"), dict):
                    version.xmp = meta.get("xmp")
                if version.other is None and isinstance(meta.get("other"), dict):
                    version.other = meta.get("other")

                recipe = normalize_recipe(version.recipe)
                version.recipe = recipe

                with img.clone() as processed:
                    _apply_recipe(processed, recipe)
                    version.rendered_width = processed.width
                    version.rendered_height = processed.height

                    for spec in PREVIEW_SPECS:
                        preview_filename = f"{spec['purpose']}.jpg"
                        rel_path = (
                            f"{spec['subdir']}/{asset.id}/v{version.version_number}/"
                            f"{preview_filename}"
                        )
                        dest = storage / rel_path
                        _generate_preview(
                            processed,
                            long_side=spec["long_side"],
                            quality=spec["quality"],
                            dest=dest,
                        )

                        preview_stat = dest.stat()
                        with Image(filename=str(dest)) as preview_img:
                            pw, ph = preview_img.width, preview_img.height

                        _upsert_version_file(
                            db,
                            version=version,
                            purpose=spec["purpose"],
                            filename=preview_filename,
                            path=rel_path,
                            width=pw,
                            height=ph,
                            size_bytes=preview_stat.st_size,
                        )

            version.preview_status = TASK_STATUS_COMPLETED
            version.preview_error = None
            apply_version_status(version)
            db.commit()

            if asset.import_batch_id and batch_previews_all_terminal(
                db, asset.import_batch_id
            ):
                scan_import_batch_duplicates.delay(str(asset.import_batch_id))

            batch = (
                db.query(ImportBatch).filter_by(id=asset.import_batch_id).first()
                if asset.import_batch_id is not None
                else None
            )
            if batch is None or batch.status != IMPORT_BATCH_STATUS_UPLOADING:
                process_asset_ml.delay(str(version.id))
        except Exception as exc:
            db.rollback()
            version = db.query(AssetVersion).filter_by(id=version_uuid).first()
            if version:
                version.preview_status = TASK_STATUS_FAILED
                version.preview_error = _truncate_error(exc)
                apply_version_status(version)
                db.commit()
            raise
    finally:
        db.close()


@celery.task(name="app.assets.tasks.process_asset_ml")
def process_asset_ml(version_id: str):
    db = SessionLocal()
    batch_id = None
    try:
        try:
            version_uuid = uuid.UUID(version_id)
        except ValueError:
            return

        version = db.query(AssetVersion).filter_by(id=version_uuid).first()
        if not version:
            return

        asset = db.query(Asset).filter_by(id=version.asset_id).first()
        if not asset:
            return

        if asset.lifecycle_status != ASSET_LIFECYCLE_ACTIVE:
            return

        batch_id = asset.import_batch_id

        preview_file = (
            db.query(File)
            .filter_by(asset_version_id=version.id, purpose="preview")
            .first()
        )

        def _fail(reason: str) -> None:
            version.faces_status = TASK_STATUS_FAILED
            version.faces_error = reason[:ERROR_TEXT_LIMIT]
            apply_version_status(version)
            db.commit()

        if not preview_file:
            _fail("Превью не найдено: нечего обрабатывать ML")
            return

        preview_path = Path(settings.storage_root) / preview_file.path
        if not preview_path.exists():
            _fail(f"Файл превью отсутствует на диске: {preview_file.path}")
            return

        version.faces_status = TASK_STATUS_PROCESSING
        version.faces_error = None
        apply_version_status(version)
        db.commit()

        try:
            db.query(FaceDetection).filter_by(asset_version_id=version.id).delete()
            db.flush()

            _save_face_detections(db, version, preview_path)
            db.flush()

            transfer_user_assignments_from_base_version(
                db,
                target_version_id=version.id,
                base_version_id=version.base_version_id,
            )
            db.flush()

            match_detections_for_version(db, version.id)
            db.flush()

            _generate_face_crops(db, version, preview_path)
            promote_identity_source_version(db, version.id)

            version.faces_status = TASK_STATUS_COMPLETED
            version.faces_error = None
            apply_version_status(version)
            db.commit()
        except Exception as exc:
            db.rollback()
            version = db.query(AssetVersion).filter_by(id=version_uuid).first()
            if version:
                version.faces_status = TASK_STATUS_FAILED
                version.faces_error = _truncate_error(exc)
                apply_version_status(version)
                db.commit()
    finally:
        try:
            _finalize_batch_if_done(db, batch_id)
        finally:
            db.close()
