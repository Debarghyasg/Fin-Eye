"""
BM25 sparse retrieval store — FREE (Redis + rank-bm25).

Unchanged from Week 3 — Redis is already free and runs in Docker.

Architecture
------------
After chunking a document:
  1. Fetch ALL chunk texts for the workspace from Postgres.
  2. Build a BM25Okapi index over the entire workspace corpus.
  3. Pickle the index + chunk_id mapping → store in Redis under bm25:{workspace_id}.
  4. TTL = 7 days. Rebuilt on every document add or delete.

At query time:
  1. Load from Redis (cache hit ~1 ms).
  2. Tokenise + score the query.
  3. Return top-k (chunk_id, score, rank) pairs to the retriever.

The chunk_id stored in the BM25 corpus matches the pinecone_id column in Postgres
(format: "{document_id}_{chunk_index}") — same ID used by ChromaDB.
"""
from __future__ import annotations

import asyncio
import logging
import pickle
from typing import TYPE_CHECKING

from app.core.config import settings

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

log = logging.getLogger(__name__)

_redis_client = None


async def _get_redis():
    global _redis_client
    if _redis_client is None:
        import redis.asyncio as aioredis
        _redis_client = aioredis.from_url(
            settings.REDIS_URL,
            encoding="utf-8",
            decode_responses=False,
        )
        log.info("Redis connected: %s", settings.REDIS_URL)
    return _redis_client


def _redis_key(workspace_id: str) -> str:
    return f"bm25:{workspace_id}"


def _tokenise(text: str) -> list[str]:
    """Simple whitespace tokeniser — keeps tickers and dollar amounts intact."""
    return text.lower().split()


async def build_and_store_bm25(
    workspace_id: str,
    db: "AsyncSession",
) -> int:
    """
    Rebuild the BM25 index for an entire workspace and cache in Redis.

    Called after every document add or delete.
    Returns number of chunks indexed (0 means cache was cleared).
    """
    from sqlalchemy import select
    from app.db.models import Chunk, Document

    result = await db.execute(
        select(Chunk.id, Chunk.text)
        .join(Document, Chunk.document_id == Document.id)
        .where(Document.workspace_id == workspace_id)
        .order_by(Chunk.document_id, Chunk.chunk_index)
    )
    rows = result.all()

    if not rows:
        r = await _get_redis()
        await r.delete(_redis_key(workspace_id))
        log.info("BM25 cache cleared for workspace %s (no chunks)", workspace_id)
        return 0

    chunk_ids     = [row[0] for row in rows]
    corpus_texts  = [row[1] for row in rows]

    def _build(texts: list[str]):
        from rank_bm25 import BM25Okapi
        return BM25Okapi([_tokenise(t) for t in texts])

    bm25_index = await asyncio.to_thread(_build, corpus_texts)

    payload = pickle.dumps({
        "index":        bm25_index,
        "chunk_ids":    chunk_ids,
        "workspace_id": workspace_id,
    })

    r = await _get_redis()
    await r.setex(_redis_key(workspace_id), settings.REDIS_BM25_TTL, payload)

    log.info(
        "BM25 index built: workspace=%s chunks=%d bytes=%d",
        workspace_id, len(chunk_ids), len(payload),
    )
    return len(chunk_ids)


async def query_bm25(
    query: str,
    workspace_id: str,
    top_k: int = 20,
    document_ids: list[str] | None = None,
) -> list[dict]:
    """
    Score query against the workspace BM25 corpus from Redis.

    Returns up to top_k dicts: [{"chunk_id": "...", "score": 3.14, "rank": 0}, ...]
    Returns [] on cache miss (caller falls back to dense-only).
    """
    r   = await _get_redis()
    raw = await r.get(_redis_key(workspace_id))

    if raw is None:
        log.warning("BM25 cache miss for workspace %s", workspace_id)
        return []

    payload    = pickle.loads(raw)
    bm25_index = payload["index"]
    chunk_ids: list[str] = payload["chunk_ids"]

    def _score(q: str) -> list[float]:
        return bm25_index.get_scores(_tokenise(q)).tolist()

    scores = await asyncio.to_thread(_score, query)

    scored = [
        {"chunk_id": cid, "score": float(s), "rank": 0}
        for cid, s in zip(chunk_ids, scores)
        if s > 0
    ]

    if document_ids:
        doc_set = set(document_ids)
        scored  = [
            item for item in scored
            if any(item["chunk_id"].startswith(did) for did in doc_set)
        ]

    scored.sort(key=lambda x: x["score"], reverse=True)
    for i, item in enumerate(scored):
        item["rank"] = i

    return scored[:top_k]
