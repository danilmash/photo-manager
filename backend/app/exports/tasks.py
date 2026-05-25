import tempfile
import uuid
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.assets.render import render_asset_export_bytes
from app.celery_app import celery
from app.database import SessionLocal
from app.exports.models import (
    EXPORT_STATUS_COMPLETED,
    EXPORT_STATUS_FAILED,
    EXPORT_STATUS_PROCESSING,
    ExportJob,
)
from app.exports.service import export_zip_absolute_path, resolve_export_assets

ERROR_TEXT_LIMIT = 2000


def _truncate_error(exc: BaseException) -> str:
    text = str(exc) or exc.__class__.__name__
    if len(text) > ERROR_TEXT_LIMIT:
        text = text[:ERROR_TEXT_LIMIT]
    return text


@celery.task(name="app.exports.tasks.build_export_zip")
def build_export_zip(job_id: str) -> None:
    db = SessionLocal()
    job_uuid: uuid.UUID | None = None
    try:
        try:
            job_uuid = uuid.UUID(job_id)
        except ValueError:
            return

        job = db.query(ExportJob).filter_by(id=job_uuid).first()
        if not job:
            return

        job.status = EXPORT_STATUS_PROCESSING
        job.processed = 0
        job.error = None
        job.zip_path = None
        db.commit()

        asset_ids = [uuid.UUID(value) for value in job.asset_ids]
        items = resolve_export_assets(db, asset_ids)

        zip_path = export_zip_absolute_path(job_uuid)
        zip_path.parent.mkdir(parents=True, exist_ok=True)

        used_names: set[str] = set()

        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            for index, item in enumerate(items):
                blob, filename, _mime = render_asset_export_bytes(
                    original_path=item.original_path,
                    recipe=item.recipe,
                    source_filename=item.source_filename,
                    source_mime=item.source_mime,
                    title=item.title,
                    asset_id=item.asset_id,
                )

                archive_name = filename
                if archive_name in used_names:
                    stem = Path(filename).stem
                    ext = Path(filename).suffix
                    archive_name = f"{stem}_{index + 1}{ext}"
                used_names.add(archive_name)

                temp_file = temp_root / archive_name
                temp_file.write_bytes(blob)

                job.processed = index + 1
                db.commit()

            with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                for temp_file in sorted(temp_root.iterdir()):
                    archive.write(temp_file, arcname=temp_file.name)

        job.zip_path = f"exports/{job_uuid}.zip"
        job.status = EXPORT_STATUS_COMPLETED
        job.error = None
        job.expires_at = datetime.now(timezone.utc) + timedelta(hours=24)
        db.commit()
    except Exception as exc:
        db.rollback()
        if job_uuid is not None:
            job = db.query(ExportJob).filter_by(id=job_uuid).first()
            if job:
                job.status = EXPORT_STATUS_FAILED
                job.error = _truncate_error(exc)
                db.commit()
        raise
    finally:
        db.close()
