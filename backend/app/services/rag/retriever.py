"""
Hybrid retriever — Week 3.

Pipeline
--------
1. Dense retrieval  — embed query → Pinecone top-20 (filtered by workspace namespace)
2. Sparse retrieval — BM25 top-20 from Redis-cached workspace corpus
3. RRF merge        — Reciprocal Rank Fusion of both ranked lists → top-20 candidates
4. Return candidates to the reranker (with full text fetched from DB)

Reciprocal Rank Fusion formula
-------------------------------
  RRF_score(d) = Σ  1 / (k + rank_i(d))
                 i

  Where k = 60 (standard constant), rank_i(d) is the 1-based rank of document d
  in result list i (dense or sparse). Documents not in a list get rank = ∞ (score 0).

  Reference: Cormack, Clarke, Buettcher (SIGIR 2009).

Why namespace = workspace_id?
------------------------------
  Each workspace gets its own Pinecone namespace. This gives free per-workspace
  isolation without needing a separate index or metadata filter.
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


# ── Dense retrieval ───────────────────────────────────────────────────────────
def _embed_query(query: str) -> list[float]:
    """Embed a single query string using OpenAI text-embedding-3-large."""
    from openai import OpenAI
    client = OpenAI(api_key=settings.OPENAI_API_KEY)
    response = client.embeddings.create(
        model=settings.OPENAI_EMBEDDING_MODEL,
        input=[query],
        encoding_format="float",
    )
    return response.data[0].embedding


def _pinecone_query(
    vector: list[float],
    namespace: str,
    top_k: int,
    filter_doc_ids: list[str] | None,
) -> list[dict]:
    """
    Query Pinecone for nearest neighbours.

    Returns list of dicts:
        [{"chunk_id": "...", "score": 0.92, "metadata": {...}}, ...]
    """
    from pinecone import Pinecone
    pc = Pinecone(api_key=settings.PINECONE_API_KEY)
    index = pc.Index(settings.PINECONE_INDEX_NAME)

    query_kwargs: dict = dict(
        vector=vector,
        top_k=top_k,
        namespace=namespace,
        include_metadata=True,
    )

    # Optional: filter by specific document IDs
    if filter_doc_ids:
        query_kwargs["filter"] = {"document_id": {"$in": filter_doc_ids}}

    response = index.query(**query_kwargs)

    return [
        {
            "chunk_id": match["id"],
            "score":    float(match["score"]),
            "metadata": match.get("metadata", {}),
            "rank":     i,
        }
        for i, match in enumerate(response.get("matches", []))
    ]


# ── Reciprocal Rank Fusion ────────────────────────────────────────────────────
def _rrf_merge(
    dense_results: list[dict],
    sparse_results: list[dict],
    k: int = 60,
) -> list[dict]:
    """
    Merge dense + sparse ranked lists using Reciprocal Rank Fusion.

    Returns a single merged list sorted by descending RRF score.
    Each item in the output carries both its dense and sparse scores
    for debugging / explainability.
    """
    scores: dict[str, dict] = {}

    # Dense contribution
    for item in dense_results:
        cid = item["chunk_id"]
        rank = item["rank"] + 1   # 1-based
        rrf = 1.0 / (k + rank)
        if cid not in scores:
            scores[cid] = {
                "chunk_id":     cid,
                "rrf_score":    0.0,
                "dense_score":  0.0,
                "sparse_score": 0.0,
                "metadata":     item.get("metadata", {}),
            }
        scores[cid]["rrf_score"]   += rrf
        scores[cid]["dense_score"]  = item["score"]

    # Sparse contribution
    for item in sparse_results:
        cid = item["chunk_id"]
        rank = item["rank"] + 1   # 1-based
        rrf = 1.0 / (k + rank)
        if cid not in scores:
            scores[cid] = {
                "chunk_id":     cid,
                "rrf_score":    0.0,
                "dense_score":  0.0,
                "sparse_score": 0.0,
                "metadata":     {},    # no metadata from BM25 — fetch from DB later
            }
        scores[cid]["rrf_score"]    += rrf
        scores[cid]["sparse_score"]  = item["score"]

    merged = sorted(scores.values(), key=lambda x: x["rrf_score"], reverse=True)
    return merged


# ── Fetch chunk text + DB metadata for candidates ────────────────────────────
async def _enrich_with_db(
    candidates: list[dict],
    db: "AsyncSession",
) -> list[dict]:
    """
    For candidates that don't have full text in Pinecone metadata (truncated at
    1000 chars), fetch the full text from Postgres.

    Also attaches the DB chunk_id (UUID) and document relationship data.
    """
    from app.db.models import Chunk

    pinecone_ids = [c["chunk_id"] for c in candidates]
    result = await db.execute(
        select(Chunk).where(Chunk.pinecone_id.in_(pinecone_ids))
    )
    db_chunks = {chunk.pinecone_id: chunk for chunk in result.scalars().all()}

    enriched = []
    for candidate in candidates:
        pid = candidate["chunk_id"]
        db_chunk = db_chunks.get(pid)
        if db_chunk is None:
            # Chunk in Pinecone but not in DB (shouldn't happen) — skip
            log.warning("Pinecone id %r not found in DB — skipping", pid)
            continue
        enriched.append({
            "chunk_id":      db_chunk.id,          # DB UUID
            "pinecone_id":   pid,
            "document_id":   db_chunk.document_id,
            "text":          db_chunk.text,         # full text from DB
            "chunk_type":    db_chunk.chunk_type,
            "page_number":   db_chunk.page_number,
            "source_section":db_chunk.source_section,
            "rrf_score":     candidate["rrf_score"],
            "dense_score":   candidate["dense_score"],
            "sparse_score":  candidate["sparse_score"],
        })

    return enriched


# ── Public entry point ────────────────────────────────────────────────────────
async def retrieve(
    request: "QueryRequest",
    db: "AsyncSession",
    top_k: int | None = None,
) -> list[dict]:
    """
    Hybrid retrieval: dense (Pinecone) + sparse (BM25) → RRF merge → top-k.

    Returns a list of enriched candidate dicts ready for the reranker:
        [{
            "chunk_id":      "<db-uuid>",
            "document_id":   "...",
            "text":          "full chunk text",
            "chunk_type":    "prose"|"table"|"header",
            "page_number":   3,
            "source_section":"Risk Factors",
            "rrf_score":     0.031,
            "dense_score":   0.87,
            "sparse_score":  4.2,
        }, ...]
    """
    top_k = top_k or settings.RETRIEVER_TOP_K
    namespace = request.workspace_id
    doc_ids = request.document_ids or None

    # ── 1. Embed query ────────────────────────────────────────────────────────
    query_vector = await asyncio.to_thread(_embed_query, request.query)

    # ── 2. Dense retrieval (Pinecone) ─────────────────────────────────────────
    dense_results = await asyncio.to_thread(
        _pinecone_query, query_vector, namespace, top_k, doc_ids
    )
    log.debug("Dense retrieval: %d results for query %r", len(dense_results), request.query[:80])

    # ── 3. Sparse retrieval (BM25 from Redis) ─────────────────────────────────
    sparse_results = await query_bm25(
        query=request.query,
        workspace_id=request.workspace_id,
        top_k=top_k,
        document_ids=doc_ids,
    )
    log.debug("Sparse retrieval: %d results", len(sparse_results))

    # ── 4. RRF merge ──────────────────────────────────────────────────────────
    merged = _rrf_merge(dense_results, sparse_results, k=settings.RRF_K)
    log.debug("RRF merged: %d unique candidates", len(merged))

    # ── 5. Enrich with full text from DB ──────────────────────────────────────
    candidates = await _enrich_with_db(merged[:top_k], db)

    log.info(
        "Retrieval complete: query=%r workspace=%s candidates=%d",
        request.query[:60], request.workspace_id, len(candidates),
    )
    return candidates
