"""
Deprecated — BM25 sparse retrieval superseded by pgvector cosine search.

In v1 of FinSight this module owned a Redis-cached, per-workspace BM25
index. Vector search has since moved to PostgreSQL pgvector (dense cosine
similarity via the ``<=>`` operator in ``pg_vector_store.py``).

The two public functions are kept as no-op shims so any caller that still
imports them continues to work without modification.
Remove this module once ``ruff check`` confirms it has no importers.
"""
from __future__ import annotations

import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

log = logging.getLogger(__name__)

_warned = False


def _warn_once() -> None:
    global _warned
    if _warned:
        return
    log.warning(
        "app.services.rag.bm25_store is deprecated — pgvector handles "
        "similarity search inside PostgreSQL now. This call is a no-op."
    )
    _warned = True


async def build_and_store_bm25(
    workspace_id: str,
    db: "AsyncSession",
) -> int:
    """Deprecated. Returns 0 unconditionally."""
    _warn_once()
    return 0


async def query_bm25(
    query: str,
    workspace_id: str,
    top_k: int = 20,
    document_ids: list[str] | None = None,
) -> list[dict]:
    """Deprecated. Returns an empty list — Qdrant handles sparse natively."""
    _warn_once()
    return []
