"""
Celery tasks — durable async work units.

Two tasks live here:

  * ``process_document``           — extraction → PII scan → chunking →
                                      embedding (Qdrant). Runs whenever a
                                      document is uploaded.
  * ``poll_edgar_subscriptions``   — periodic SEC EDGAR poll, scheduled by
                                      Celery Beat using
                                      ``EDGAR_POLL_INTERVAL_SECONDS``.

Both wrap async coroutines via ``asyncio.run`` because Celery's mainline
support is sync. Workers run with ``--concurrency=1`` for the document
queue (the embedding model is GPU-RAM-style memory-hungry on CPU and we'd
rather pre-fork extra workers than thread them), and acks are sent late so
a crash mid-extraction re-queues the message rather than losing it.
"""
from __future__ import annotations

import asyncio
from typing import Any

from celery.utils.log import get_task_logger

from app.services.celery_app import celery_app

log = get_task_logger(__name__)


# ── Document processing ──────────────────────────────────────────────────────
@celery_app.task(
    name="app.services.tasks.process_document",
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,            # exponential: 30s, 60s, 120s, …
    retry_backoff_max=600,         # cap at 10 min
    retry_jitter=True,
    max_retries=3,
)
def process_document(
    self,
    document_id: str,
    s3_key: str,
    mime_type: str,
) -> dict[str, Any]:
    """Run the full ingestion pipeline for a freshly uploaded document.

    Returns a small status dict for the Celery result backend / Flower so
    operators can see at a glance how a job ended.
    """
    log.info("process_document start id=%s mime=%s try=%d",
             document_id, mime_type, self.request.retries)

    # Defer the import — pulling in the FastAPI app at module load slows
    # worker boot and causes circular imports with the audit logger.
    from app.api.routes.documents import _process_document_pipeline

    asyncio.run(_process_document_pipeline(document_id, s3_key, mime_type))

    log.info("process_document done id=%s", document_id)
    return {"document_id": document_id, "status": "processed"}


# ── EDGAR poller ──────────────────────────────────────────────────────────────
@celery_app.task(
    name="app.services.tasks.poll_edgar_subscriptions",
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=300,
    retry_jitter=True,
    max_retries=3,
)
def poll_edgar_subscriptions() -> dict[str, Any]:
    """Periodic Celery Beat task — poll SEC EDGAR for new filings.

    The actual HTTP work and database side effects already exist in
    ``app.services.edgar.poll_all_subscriptions``; this task is the durable
    Beat-scheduled entry point that replaces the in-process asyncio loop.
    """
    log.info("poll_edgar_subscriptions tick")

    from app.db.session import AsyncSessionLocal
    from app.services.edgar import poll_all_subscriptions

    async def _run() -> dict[str, Any]:
        async with AsyncSessionLocal() as db:
            summary = await poll_all_subscriptions(db, dispatch_emails=True)
            await db.commit()
            return summary

    summary = asyncio.run(_run())
    log.info(
        "poll_edgar_subscriptions complete subs=%d new=%d alerts=%d",
        summary.get("subscriptions_checked", 0),
        summary.get("total_new_filings", 0),
        summary.get("alerts_created", 0),
    )
    return summary
