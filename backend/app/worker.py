from celery import Celery

from .config import settings

celery_app = Celery("gather", broker=settings.redis_url, backend=settings.redis_url)
celery_app.conf.update(task_serializer="json", accept_content=["json"], result_serializer="json")
celery_app.autodiscover_tasks(["backend.app"])