from celery import Celery
from app.config import settings

celery = Celery(
    "photo_manager",
    broker=settings.redis_url,
    backend=settings.redis_url,
)

celery.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    task_track_started=True,
)

celery.autodiscover_tasks(["app.assets"])