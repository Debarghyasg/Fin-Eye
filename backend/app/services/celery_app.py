"""
Celery application — durable async pipeline backed by RabbitMQ.

PDF §0 explicitly rejects Redis as a Celery broker ("Redis is a cache, not a
broker"). RabbitMQ provides:

    * persistent, on-disk message storage so a worker crash mid-processing
      does not lose the document
    * native dead-letter exchanges
    * AMQP ack/nack semantics matching what AWS SQS visibility timeouts give
      you in production
    * a management UI on :15672 for queue inspection

Production swap-in
------------------
Replace ``CELERY_BROKER_URL`` with ``sqs://...``. The Celery task function
bodies become AWS Lambda handler bodies one-to-one — no business logic
change.

Why a separate module
---------------------
Celery's task auto-discovery and Beat schedule both need to import this
module *without* triggering a FastAPI app startup. Keeping it free of
imports from ``app.main`` and the route layer guarantees that workers can
start in their own container with the minimal subset of the codebase.
"""
from __future__ import annotations

import logging

from celery import Celery

from app.core.config import settings

log = logging.getLogger(__name__)

# ── Singleton Celery app ──────────────────────────────────────────────────────
celery_app = Celery(
    "finsight",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
    include=["app.services.tasks"],   # auto-import task module on boot
)

# ── Configuration ─────────────────────────────────────────────────────────────
celery_app.conf.update(
    # Routing
    task_default_queue=settings.CELERY_TASK_DEFAULT_QUEUE,
    task_default_exchange=settings.CELERY_TASK_DEFAULT_QUEUE,
    task_default_routing_key=settings.CELERY_TASK_DEFAULT_QUEUE,

    # Eager mode for tests — runs the task synchronously in-process.
    task_always_eager=settings.CELERY_TASK_ALWAYS_EAGER,
    task_eager_propagates=settings.CELERY_TASK_ALWAYS_EAGER,

    # Time / size limits — protect workers from runaway PDFs
    task_time_limit=15 * 60,           # hard kill after 15 min
    task_soft_time_limit=12 * 60,      # SoftTimeLimitExceeded raised at 12 min
    task_acks_late=True,               # ack only after the task succeeds
    task_reject_on_worker_lost=True,   # requeue if the worker crashes
    worker_prefetch_multiplier=1,      # one heavy task per worker at a time
    worker_max_tasks_per_child=50,     # recycle workers to release ML model RAM

    # Retries — exponential backoff with jitter
    task_default_retry_delay=30,       # 30s base delay
    task_acks_on_failure_or_timeout=False,

    # Serialization
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,

    # Result storage — short-lived; we use Postgres as the source of truth
    result_expires=3600,

    # Beat schedule — driven by USE_EDGAR_POLLER + EDGAR_POLL_INTERVAL_SECONDS
    beat_schedule={
        settings.EDGAR_POLLER_BEAT_NAME: {
            "task": "app.services.tasks.poll_edgar_subscriptions",
            "schedule": float(settings.EDGAR_POLL_INTERVAL_SECONDS),
            "options": {"queue": settings.CELERY_TASK_DEFAULT_QUEUE},
        },
    } if settings.USE_EDGAR_POLLER else {},
)


@celery_app.on_after_configure.connect
def _log_celery_config(sender: Celery, **_: object) -> None:
    """Print broker + queue config once on worker startup for ops visibility."""
    log.info(
        "Celery configured: broker=%s queue=%s eager=%s edgar_beat=%s",
        settings.CELERY_BROKER_URL.split("@")[-1],   # hide credentials
        settings.CELERY_TASK_DEFAULT_QUEUE,
        settings.CELERY_TASK_ALWAYS_EAGER,
        settings.USE_EDGAR_POLLER,
    )
