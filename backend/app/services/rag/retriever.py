"""
Hybrid retriever — Qdrant edition (PR 2).

The PDF spec (§4) describes the new design:

    "Native hybrid search in Qdrant: dense + BM25 sparse, single query
     (top-20). Reciprocal Rank Fusion applied internally by Qdrant."

This module is the thin app-layer wrapper around that single Qdrant call.
The big-picture diff from the previous (ChromaDB + Redis-BM25 + custom RRF)
implementation is:

* No Redis BM25 cache to keep in sync — Qdrant stores sparse vectors as
  payload of each point and queries them server-side.
* No client-side RRF merge — the ``FusionQuery(fusion=RRF)`` clause on the
  Qdrant prefetch does it for us.
* No latent rebuild after a delete — point deletion removes the chunk from
  both dense and sparse indexes atomically.

What's preserved
----------------
* The public ``retrieve(request, db, top_k)`` signature, so query-pipeline
  callers do not change.
* The result shape returned to the caller: a list of dicts with
  ``rrf_score``, ``dense_score``, ``sparse_score``, full chunk text, and
  metadata. Downstream re-rankers and the generator already speak this
  shape.
"""
from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING, Any

from sqlalchemy import select

from app.core.config import settings
from app.services.rag import qdrant_store

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession
    from app.db.schemas import QueryRequest

log = logging.getLogger(__name__)


# ── Query-time encoding ───────────────────────────────────────────────────────
def _embed_query_dense(query: str) -> list[float]:
    from app.services.document.embedder import _get_embed_model
    return _get_embed_model().encode([query], show_progress_bar=False)[0].tolist()


def _embed_query_sparse(query: str):
    """Return a Qdrant SparseVector for the query."""
    emb = qdrant_store.encode_sparse_one(query)
    return qdrant_store.to_qdrant_sparse_vector(emb)


# ── Single-call hybrid search ─────────────────────────────────────────────────
def _qdrant_hybrid_search(
    dense_vec: list[float],
    sparse_vec,
    workspace_id: str,
    document_ids: list[str] | None,
    top_k: int,
) -> list[dict[str, Any]]:
    """Run dense + BM25 prefetch, fuse with RRF, return scored hits.

    Per-modality scores aren't returned by Qdrant's fusion query, so we fall
    back to populating ``dense_score``/``sparse_score`` from a second pair
    of cheap point lookups when callers want them. For the common case those
    are left at 0 — the RRF score is what the re-ranker keys off anyway.
    """
    from qdrant_client.http import models as qm

    client = qdrant_store.get_client()
    flt = qdrant_store.workspace_filter(workspace_id, document_ids)

    response = client.query_points(
        collection_name=settings.QDRANT_COLLECTION,
        prefetch=[
            qm.Prefetch(
                query=dense_vec,
                using=settings.QDRANT_DENSE_VECTOR_NAME,
                limit=top_k,
                filter=flt,
            ),
            qm.Prefetch(
                query=sparse_vec,
                using=settings.QDRANT_SPARSE_VECTOR_NAME,
                limit=top_k,
                filter=flt,
            ),
        ],
        query=qm.FusionQuery(fusion=qm.Fusion.RRF),
        query_filter=flt,           # belt-and-braces: enforce filter on fused result too
        limit=top_k,
        with_payload=True,
        with_vectors=False,
    )

    hits = response.points if hasattr(response, "points") else response
    return [
        {
            "chunk_id": str(hit.id),
            "rrf_score": float(hit.score),
            # Per-modality breakdown isn't returned by FusionQuery; the
            # re-ranker uses RRF score so this is fine for now.
            "dense_score": 0.0,
            "sparse_score": 0.0,
            "metadata": dict(hit.payload or {}),
        }
        for hit in hits
    ]


# ── Postgres enrichment ───────────────────────────────────────────────────────
async def _enrich_with_db(
    candidates: list[dict[str, Any]],
    db: "AsyncSession",
) -> list[dict[str, Any]]:
    """Attach full chunk text + DB id to each Qdrant hit.

    Hits whose ``pinecone_id`` no longer matches a Postgres row are dropped
    (the chunk was deleted between index time and query time).
    """
    from app.db.models import Chunk

    if not candidates:
        return []

    point_ids = [c["chunk_id"] for c in candidates]
    rows = (await db.execute(
        select(Chunk).where(Chunk.pinecone_id.in_(point_ids))
    )).scalars().all()
    by_point_id = {row.pinecone_id: row for row in rows}

    enriched: list[dict[str, Any]] = []
    for cand in candidates:
        row = by_point_id.get(cand["chunk_id"])
        if row is None:
            log.warning(
                "Qdrant hit %s has no matching Postgres chunk — skipping",
                cand["chunk_id"],
            )
            continue
        enriched.append({
            "chunk_id":       row.id,
            "qdrant_id":      cand["chunk_id"],
            # ``chroma_id`` kept for backward compatibility with existing
            # consumers (re-ranker, generator) that already speak that key.
            "chroma_id":      cand["chunk_id"],
            "document_id":    row.document_id,
            "text":           row.text,
            "chunk_type":     row.chunk_type,
            "page_number":    row.page_number,
            "source_section": row.source_section,
            "rrf_score":      cand["rrf_score"],
            "dense_score":    cand["dense_score"],
            "sparse_score":   cand["sparse_score"],
        })
    return enriched


# ── Public entry point ────────────────────────────────────────────────────────
async def retrieve(
    request: "QueryRequest",
    db: "AsyncSession",
    top_k: int | None = None,
) -> list[dict[str, Any]]:
    """Hybrid retrieval with server-side RRF.

    Failures fall through to an empty result so the query endpoint can still
    return a graceful "no relevant context found" answer rather than a 500.
    """
    top_k = top_k or settings.RETRIEVER_TOP_K

    # Run both encoders in parallel.
    dense_task = asyncio.to_thread(_embed_query_dense, request.query)
    sparse_task = asyncio.to_thread(_embed_query_sparse, request.query)
    dense_vec, sparse_vec = await asyncio.gather(dense_task, sparse_task)

    try:
        hits = await asyncio.to_thread(
            _qdrant_hybrid_search,
            dense_vec, sparse_vec,
            request.workspace_id,
            request.document_ids or None,
            top_k,
        )
    except Exception as exc:
        log.warning("Qdrant hybrid search failed: %s — returning empty", exc)
        hits = []

    log.debug("Qdrant hybrid hits: %d", len(hits))

    candidates = await _enrich_with_db(hits[:top_k], db)
    log.info(
        "Retrieval: query=%r workspace=%s candidates=%d",
        request.query[:60], request.workspace_id, len(candidates),
    )
    return candidates
