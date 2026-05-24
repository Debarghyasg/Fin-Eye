"""
BM25 sparse retrieval store — Week 3.

Architecture
------------
After a document finishes chunking, we:
  1. Fetch all chunk texts for that workspace from Postgres.
  2. Build a BM25Okapi index over the entire workspace corpus.
  3. Serialise the index with pickle and write it to Redis under the key:
       bm25:{workspace_id}
  4. Set TTL = 7 days (REDIS_BM25_TTL). The index is rebuilt on every
     new document or deletion so it stays fresh.

At query time:
  1. Load the serialised index from Redis (cache hit ~1 ms).
  2. Tokenise the query and score all documents in the corpus.
  3. Return the top-k (chunk_id, score) pairs.

Why workspace-level (not document-level)?
  Financial queries often span multiple documents ("compare AAPL FY22 vs FY23").
  A workspace-level BM25 index allows cross-document sparse retrieval without
  having to merge separate per-document indices at query time.

Key design choices
------------------
- Tokenisation: simple whitespace + lowercase. Good enough for financial text
  with product codes, tickers, and dollar amounts. Swap for a proper tokeniser
  (e.g. nltk word_tokenize) if recall needs improving.
- Pickle: faster than JSON for large numpy arrays. Stored in Redis bytes field.
- TTL: 7 days. Rebuilt on every document add/delete, so the TTL is just a
  safety net for stale data.
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

# ── Redis client singleton ────────────────────────────────────────────────────
_redis_client = None


async def _get_redis():
    """Return a cached async Redis client."""
    global _redis_client
    if _redis_client is None:
        import redis.asyncio as aioredis
        _redis_client = aioredis.from_url(
            settings.REDIS_URL,
            encoding="utf-8",
            decode_responses=False,   # we store raw bytes (pickle)
        )
        log.info("Redis client connected to %s", settings.REDIS_URL)
    return _redis_client


def _redis_key(workspace_id: str) -> str:
    return f"bm25:{workspace_id}"


# ── Tokeniser ─────────────────────────────────────────────────────────────────
def _tokenise(text: str) -> list[str]:
    """
    Simple whitespace tokeniser with lowercasing.
    Keeps tickers, dollar amounts, and numeric strings intact.
    """
    return text.lower().split()


# ── Build and persist BM25 index ──────────────────────────────────────────────
async def build_and_store_bm25(
    workspace_id: str,
    db: "AsyncSession",
) -> int:
    """
    Rebuild the BM25 index for an entire workspace and store it in Redis.

    Called after:
      - A document finishes chunking (add new chunks to corpus)
      - A document is deleted (remove chunks from corpus)

    Returns the number of chunks indexed.
    """
    from sqlalchemy import select
    from app.db.models import Chunk, Document

    # ── Fetch all chunk texts for the workspace ───────────────────────────────
    result = await db.execute(
        select(Chunk.id, Chunk.text)
        .join(Document, Chunk.document_id == Document.id)
        .where(Document.workspace_id == workspace_id)
        .order_by(Chunk.document_id, Chunk.chunk_index)
    )
    rows = result.all()

    if not rows:
        log.info("No chunks found for workspace %s — clearing BM25 cache", workspace_id)
        r = await _get_redis()
        await r.delete(_redis_key(workspace_id))
        return 0

    chunk_ids = [row[0] for row in rows]
    corpus_texts = [row[1] for row in rows]

    # ── Build BM25 index (CPU-bound — run in thread) ──────────────────────────
    def _build(texts: list[str]) -> object:
        from rank_bm25 import BM25Okapi
        tokenised = [_tokenise(t) for t in texts]
        return BM25Okapi(tokenised)

    bm25_index = await asyncio.to_thread(_build, corpus_texts)

    # ── Serialise and store in Redis ──────────────────────────────────────────
    payload = pickle.dumps({
        "index":      bm25_index,
        "chunk_ids":  chunk_ids,       # positional mapping: index i → chunk_id
        "workspace_id": workspace_id,
    })

    r = await _get_redis()
    await r.setex(_redis_key(workspace_id), settings.REDIS_BM25_TTL, payload)

    log.info(
        "BM25 index built: workspace=%s chunks=%d size_bytes=%d",
        workspace_id, len(chunk_ids), len(payload),
    )
    return len(chunk_ids)


# ── Query BM25 index ──────────────────────────────────────────────────────────
async def query_bm25(
    query: str,
    workspace_id: str,
    top_k: int = 20,
    document_ids: list[str] | None = None,
) -> list[dict]:
    """
    Score the query against the workspace BM25 corpus.

    Returns a list of up to top_k dicts:
        [{"chunk_id": "...", "score": 3.14, "rank": 0}, ...]

    If the index is not in Redis (cache miss), returns an empty list —
    the caller falls back to dense-only retrieval.

    `document_ids` — if provided, only return chunks from those documents.
    We can't filter inside BM25 natively, so we retrieve more and filter after.
    """
    r = await _get_redis()
    raw = await r.get(_redis_key(workspace_id))

    if raw is None:
        log.warning(
            "BM25 cache miss for workspace %s — skipping sparse retrieval", workspace_id
        )
        return []

    payload = pickle.loads(raw)
    bm25_index = payload["index"]
    chunk_ids: list[str] = payload["chunk_ids"]

    # ── Score (CPU-bound) ─────────────────────────────────────────────────────
    def _score(query_text: str) -> list[float]:
        tokens = _tokenise(query_text)
        return bm25_index.get_scores(tokens).tolist()

    scores = await asyncio.to_thread(_score, query)

    # ── Build ranked list ─────────────────────────────────────────────────────
    scored = [
        {"chunk_id": cid, "score": float(s), "rank": 0}
        for cid, s in zip(chunk_ids, scores)
        if s > 0   # skip zero-score chunks (no keyword overlap)
    ]

    # Optional document filter
    if document_ids:
        doc_set = set(document_ids)
        # chunk_id format is "{document_id}_{chunk_index}" — extract doc prefix
        scored = [
            item for item in scored
            if any(item["chunk_id"].startswith(did) for did in doc_set)
        ]

    # Sort descending by score
    scored.sort(key=lambda x: x["score"], reverse=True)

    # Assign rank (0-based)
    for i, item in enumerate(scored):
        item["rank"] = i

    return scored[:top_k]
