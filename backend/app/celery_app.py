from celery import Celery
from app.config import settings

# Регистрируем все ORM-модели в процессе воркера. Без этого SQLAlchemy
# при конфигурации мапперов не сможет резолвить строковые ссылки в
# relationship (например, ImportBatch.project -> "Project"), потому что
# классы не попадут в реестр, пока их модуль не импортирован.
import app.models  # noqa: F401

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