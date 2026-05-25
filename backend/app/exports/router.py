import uuid as uuid_mod
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.exports.models import EXPORT_STATUS_COMPLETED, ExportJob
from app.exports.schemas import ExportCreateRequest, ExportJobSchema
from app.exports.service import (
    create_export_job,
    export_zip_absolute_path,
    get_export_job_or_404,
)
from app.exports.tasks import build_export_zip
from app.users.dependencies import get_current_user
from app.users.models import User

router = APIRouter(prefix="/api/v1/exports", tags=["exports"])


def _serialize_job(job: ExportJob) -> ExportJobSchema:
    return ExportJobSchema(
        id=job.id,
        status=job.status,
        total=job.total,
        processed=job.processed,
        error=job.error,
        download_ready=job.status == EXPORT_STATUS_COMPLETED and bool(job.zip_path),
        created_at=job.created_at,
        expires_at=job.expires_at,
    )


@router.post("", response_model=ExportJobSchema, status_code=status.HTTP_202_ACCEPTED)
def create_export(
    body: ExportCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    job = create_export_job(db, user_id=current_user.id, asset_ids=body.asset_ids)
    build_export_zip.delay(str(job.id))
    return _serialize_job(job)


@router.get("/{job_id}", response_model=ExportJobSchema)
def get_export_status(
    job_id: uuid_mod.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    job = get_export_job_or_404(db, job_id)
    if job.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Задача экспорта не найдена")
    return _serialize_job(job)


@router.get("/{job_id}/download")
def download_export(
    job_id: uuid_mod.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    job = get_export_job_or_404(db, job_id)
    if job.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Задача экспорта не найдена")

    if job.status != EXPORT_STATUS_COMPLETED or not job.zip_path:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Архив ещё не готов",
        )

    if job.expires_at and job.expires_at < datetime.now(timezone.utc):
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="Срок действия ссылки на архив истёк",
        )

    zip_path = export_zip_absolute_path(job.id)
    if not zip_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Файл архива не найден",
        )

    return FileResponse(
        zip_path,
        media_type="application/zip",
        filename=f"photo-export-{job.id}.zip",
    )
