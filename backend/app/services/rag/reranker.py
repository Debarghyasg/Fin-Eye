"""
Cross-encoder re-ranker — Week 3.

Uses sentence-transformers cross-encoder/ms-marco-MiniLM-L-6-v2.
  - 6-layer MiniLM — fast on CPU (~40 ms for 20 candidates)
  - Trained on MS MARCO passage ranking — transfers well to financial Q&A
  - No GPU required, 85 MB download on first use

How it works
------------
1. Form (query, chunk_text) pairs for every candidate.
2. Pass ALL pairs through the cross-encoder in one forward pass.
3. Sort candidates descending by cross-encoder logit score.
4. Return top_n.

Why cross-encoder > bi-encoder for reranking?
----------------------------------------------
  Bi-encoders (like text-embedding-3-large) embed query and document
  independently — fast but less accurate. A cross-encoder sees both
  query and document together in the same attention window, so it can
  model fine-grained interactions like "this paragraph uses 'revenue'
  but the query asks about 'net sales' — are they the same thing?"

  The trade-off: cross-encoders are slow to run on every document in a
  corpus, which is why we use them only on the top-20 candidates from RRF.

Model loading
-------------
  The model is loaded lazily on first call and cached in _model.
  In production (ECS Fargate), bake the model into the Docker image
  to avoid a 30-second cold download on startup:
      RUN python -c "from sentence_transformers import CrossEncoder; \
          CrossEncoder('cross-encoder/ms-marco-MiniLM-L-6-v2')"
"""
from __future__ import annotations

import asyncio
import logging

log = logging.getLogger(__name__)

# ── Model singleton ───────────────────────────────────────────────────────────
_model = None


def _get_model():
    global _model
    if _model is None:
        from sentence_transformers import CrossEncoder
        from app.core.config import settings
        log.info("Loading cross-encoder model %r (first call — may take 30s)", settings.RERANKER_MODEL)
        _model = CrossEncoder(settings.RERANKER_MODEL, max_length=512)
        log.info("Cross-encoder model loaded")
    return _model


# ── Rerank (synchronous, CPU-bound) ──────────────────────────────────────────
def _rerank_sync(query: str, candidates: list[dict], top_n: int) -> list[dict]:
    """
    Score each (query, chunk_text) pair with the cross-encoder.
    Returns top_n candidates sorted by score descending.
    """
    model = _get_model()

    pairs = [(query, c["text"]) for c in candidates]
    scores = model.predict(pairs).tolist()  # returns list[float]

    for candidate, score in zip(candidates, scores):
        candidate["rerank_score"] = float(score)

    reranked = sorted(candidates, key=lambda x: x["rerank_score"], reverse=True)
    return reranked[:top_n]


# ── Public entry point ────────────────────────────────────────────────────────
async def rerank(
    query: str,
    candidates: list[dict],
    top_n: int | None = None,
) -> list[dict]:
    """
    Re-score candidate chunks with the cross-encoder.

    Input:  candidates from retriever
    Output: top_n candidates ordered by cross-encoder relevance score,
            each with an added "rerank_score" field.

    Runs in a thread pool to avoid blocking the async event loop.
    """
    from app.core.config import settings
    top_n = top_n or settings.RERANKER_TOP_N

    if not candidates:
        return []

    if len(candidates) == 1:
        candidates[0]["rerank_score"] = 1.0
        return candidates

    reranked = await asyncio.to_thread(_rerank_sync, query, candidates, top_n)

    log.info(
        "Reranking complete: input=%d output=%d top_score=%.4f",
        len(candidates),
        len(reranked),
        reranked[0]["rerank_score"] if reranked else 0.0,
    )
    return reranked
