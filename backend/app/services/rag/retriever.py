"""
Retriever — PostgreSQL dense cosine search (no pgvector, no external service).

Embeddings are stored as JSON in ``chunk_embeddings`` and ranked in Python
(see ``pg_vector_store.cosine_search``).  Runs on a vanilla PostgreSQL
install with no extensions.

What's preserved
----------------
* Public signature: ``retrieve(request, db, top_k) → list[dict]``
* Result shape returned to the caller: list of dicts with ``rrf_score``
  (the cosine score), full chunk text, and metadata.  Downstream re-ranker
  and generator already speak this shape.
"""
from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING, Any

from sqlalchemy import select

from app.core.config import settings
from app.services.rag import pg_vector_store

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession
    from app.db.schemas import QueryRequest

log = logging.getLogger(__name__)


# ── Query-time dense encoding ─────────────────────────────────────────────────
def _embed_query_dense(query: str) -> list[float]:
    from app.services.document.embedder import _get_embed_model
    return _get_embed_model().encode([query], show_progress_bar=False)[0].tolist()


# ── PostgreSQL enrichment ─────────────────────────────────────────────────────
async def _enrich_with_db(
    candidates: list[dict[str, Any]],
    db: "AsyncSession",
) -> list[dict[str, Any]]:
    """Attach full chunk text + parent document name to each pgvector hit.

    Joins via ``chunk_embeddings.chunk_id`` → ``chunks`` directly, so the
    result is correct even when ``chunks.pinecone_id`` was never written back
    (e.g. a crash between embedding batches).  The ``point_id`` returned by
    pgvector is used only for the secondary lookup, not as the join key.
    """
    from app.db.models import Chunk, Document, ChunkEmbedding

    if not candidates:
        return []

    point_ids = [c["point_id"] for c in candidates]

    # Join chunk_embeddings → chunks → documents so we never depend on
    # chunks.pinecone_id being populated.
    rows = (await db.execute(
        select(Chunk, Document.original_filename, ChunkEmbedding.point_id)
        .join(ChunkEmbedding, ChunkEmbedding.chunk_id == Chunk.id)
        .join(Document, Document.id == Chunk.document_id)
        .where(ChunkEmbedding.point_id.in_(point_ids))
    )).all()

    # Build a lookup: point_id → (Chunk, filename)
    by_point_id: dict[str, tuple] = {row[2]: row for row in rows}

    enriched: list[dict[str, Any]] = []
    for cand in candidates:
        row = by_point_id.get(cand["point_id"])
        if row is None:
            log.warning(
                "pgvector hit point_id=%s has no matching Postgres chunk — skipping",
                cand["point_id"],
            )
            continue
        chunk: Chunk = row[0]
        original_filename: str = row[1]
        enriched.append({
            "chunk_id":       chunk.id,
            "qdrant_id":      cand["point_id"],   # kept for schema compat
            "chroma_id":      cand["point_id"],   # kept for schema compat
            "document_id":    chunk.document_id,
            "document_name":  original_filename,
            "text":           chunk.text,
            "chunk_type":     chunk.chunk_type,
            "page_number":    chunk.page_number,
            "source_section": chunk.source_section,
            # pgvector cosine similarity score (0–1); passed downstream as
            # rrf_score so the reranker and generator see the same field name.
            "rrf_score":      cand["score"],
            "dense_score":    cand["score"],
            "sparse_score":   0.0,
        })
    return enriched


# ── Public entry point ────────────────────────────────────────────────────────
async def retrieve(
    request: "QueryRequest",
    db: "AsyncSession",
    top_k: int | None = None,
) -> list[dict[str, Any]]:
    """Dense cosine retrieval via PostgreSQL pgvector.

    Failures fall through to an empty result so the query endpoint still
    returns a graceful "no relevant context found" answer rather than a 500.
    """
    top_k = top_k or settings.RETRIEVER_TOP_K

    # Embed the query (CPU-bound — offload to thread pool).
    try:
        dense_vec = await asyncio.to_thread(_embed_query_dense, request.query)
    except Exception as exc:
        log.warning("Query embedding failed: %s — returning empty", exc)
        return []

    # Run dense cosine search (computed in Python — see pg_vector_store).
    try:
        hits = await pg_vector_store.cosine_search(
            query_vec=dense_vec,
            workspace_id=request.workspace_id,
            document_ids=request.document_ids or None,
            top_k=top_k,
            db=db,
        )
    except Exception as exc:
        log.warning("pgvector search failed: %s — returning empty", exc)
        hits = []

    log.debug("pgvector hits: %d", len(hits))

    candidates = await _enrich_with_db(hits, db)
    log.info(
        "Retrieval: query=%r workspace=%s candidates=%d",
        request.query[:60], request.workspace_id, len(candidates),
    )
    return candidates
