"""
Hybrid retriever — FREE stack.

Pipeline
--------
1. Dense  — embed query locally → ChromaDB top-20 (filtered by workspace_id)
2. Sparse — BM25 top-20 from Redis-cached workspace corpus
3. RRF    — Reciprocal Rank Fusion → merged top-20 candidates
4. Enrich — fetch full chunk text from Postgres

ChromaDB filtering
------------------
ChromaDB supports metadata filters via the `where` dict.
We filter by workspace_id so each workspace only sees its own documents.
Optional document_ids filter is applied as a second `where` clause.

RRF formula  (Cormack, Clarke, Buettcher — SIGIR 2009)
-------------------------------------------------------
  score(d) = Σ  1 / (k + rank_i(d))      k = 60
"""
from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING

from sqlalchemy import select

from app.core.config import settings
from app.services.rag.bm25_store import query_bm25

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession
    from app.db.schemas import QueryRequest

log = logging.getLogger(__name__)


# ── Local embedding of a query ────────────────────────────────────────────────
def _embed_query(query: str) -> list[float]:
    """Embed a single query string with the local SentenceTransformer model."""
    from app.services.document.embedder import _get_embed_model
    model = _get_embed_model()
    return model.encode([query], show_progress_bar=False)[0].tolist()


# ── ChromaDB dense retrieval ──────────────────────────────────────────────────
def _chroma_query(
    vector: list[float],
    workspace_id: str,
    top_k: int,
    document_ids: list[str] | None,
) -> list[dict]:
    """
    Query ChromaDB for nearest neighbours filtered by workspace_id.

    Returns list of dicts:
        [{"chunk_id": "doc123_0", "score": 0.91, "metadata": {...}}, ...]

    ChromaDB returns distance (lower = closer for cosine).
    We convert: score = 1 - distance  so higher = better.
    """
    from app.services.document.embedder import _get_collection
    collection = _get_collection()

    where: dict = {"workspace_id": {"$eq": workspace_id}}
    if document_ids:
        where = {
            "$and": [
                {"workspace_id": {"$eq": workspace_id}},
                {"document_id":  {"$in": document_ids}},
            ]
        }

    results = collection.query(
        query_embeddings=[vector],
        n_results=min(top_k, collection.count() or 1),
        where=where,
        include=["metadatas", "distances", "documents"],
    )

    ids        = results["ids"][0]
    distances  = results["distances"][0]
    metadatas  = results["metadatas"][0]

    return [
        {
            "chunk_id": cid,
            "score":    max(0.0, 1.0 - dist),   # cosine similarity
            "metadata": meta,
            "rank":     i,
        }
        for i, (cid, dist, meta) in enumerate(zip(ids, distances, metadatas))
    ]


# ── Reciprocal Rank Fusion ────────────────────────────────────────────────────
def _rrf_merge(
    dense_results: list[dict],
    sparse_results: list[dict],
    k: int = 60,
) -> list[dict]:
    scores: dict[str, dict] = {}

    for item in dense_results:
        cid  = item["chunk_id"]
        rank = item["rank"] + 1
        if cid not in scores:
            scores[cid] = {
                "chunk_id":     cid,
                "rrf_score":    0.0,
                "dense_score":  0.0,
                "sparse_score": 0.0,
                "metadata":     item.get("metadata", {}),
            }
        scores[cid]["rrf_score"]  += 1.0 / (k + rank)
        scores[cid]["dense_score"] = item["score"]

    for item in sparse_results:
        cid  = item["chunk_id"]
        rank = item["rank"] + 1
        if cid not in scores:
            scores[cid] = {
                "chunk_id":     cid,
                "rrf_score":    0.0,
                "dense_score":  0.0,
                "sparse_score": 0.0,
                "metadata":     {},
            }
        scores[cid]["rrf_score"]   += 1.0 / (k + rank)
        scores[cid]["sparse_score"] = item["score"]

    return sorted(scores.values(), key=lambda x: x["rrf_score"], reverse=True)


# ── Enrich candidates with full text from Postgres ────────────────────────────
async def _enrich_with_db(
    candidates: list[dict],
    db: "AsyncSession",
) -> list[dict]:
    from app.db.models import Chunk

    chroma_ids = [c["chunk_id"] for c in candidates]
    result = await db.execute(
        select(Chunk).where(Chunk.pinecone_id.in_(chroma_ids))
    )
    db_chunks = {chunk.pinecone_id: chunk for chunk in result.scalars().all()}

    enriched = []
    for candidate in candidates:
        cid      = candidate["chunk_id"]
        db_chunk = db_chunks.get(cid)
        if db_chunk is None:
            # In ChromaDB but not in DB — skip (shouldn't happen in normal flow)
            log.warning("ChromaDB id %r not found in DB — skipping", cid)
            continue
        enriched.append({
            "chunk_id":       db_chunk.id,
            "chroma_id":      cid,
            "document_id":    db_chunk.document_id,
            "text":           db_chunk.text,
            "chunk_type":     db_chunk.chunk_type,
            "page_number":    db_chunk.page_number,
            "source_section": db_chunk.source_section,
            "rrf_score":      candidate["rrf_score"],
            "dense_score":    candidate["dense_score"],
            "sparse_score":   candidate["sparse_score"],
        })

    return enriched


# ── Public entry point ────────────────────────────────────────────────────────
async def retrieve(
    request: "QueryRequest",
    db: "AsyncSession",
    top_k: int | None = None,
) -> list[dict]:
    """
    Hybrid retrieval: ChromaDB dense + BM25 sparse → RRF → top-k enriched candidates.
    """
    top_k     = top_k or settings.RETRIEVER_TOP_K
    doc_ids   = request.document_ids or None

    # 1. Embed query locally
    query_vector = await asyncio.to_thread(_embed_query, request.query)

    # 2. Dense retrieval (ChromaDB)
    try:
        dense_results = await asyncio.to_thread(
            _chroma_query, query_vector, request.workspace_id, top_k, doc_ids
        )
    except Exception as exc:
        log.warning("ChromaDB query failed: %s — dense results empty", exc)
        dense_results = []

    log.debug("Dense: %d results", len(dense_results))

    # 3. Sparse retrieval (BM25 from Redis)
    sparse_results = await query_bm25(
        query=request.query,
        workspace_id=request.workspace_id,
        top_k=top_k,
        document_ids=doc_ids,
    )
    log.debug("Sparse: %d results", len(sparse_results))

    # 4. RRF merge
    merged = _rrf_merge(dense_results, sparse_results, k=settings.RRF_K)

    # 5. Enrich with full text from Postgres
    candidates = await _enrich_with_db(merged[:top_k], db)

    log.info(
        "Retrieval: query=%r workspace=%s candidates=%d",
        request.query[:60], request.workspace_id, len(candidates),
    )
    return candidates
