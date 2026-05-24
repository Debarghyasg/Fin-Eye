"""
Cross-encoder re-ranker — Week 3 stub.

Week 3 implementation plan:
  Option A (self-hosted, cheapest):
    - Load sentence-transformers cross-encoder/ms-marco-MiniLM-L-6-v2
    - Score (query, chunk_text) pairs in a single forward pass
    - Sort descending, return top-n

  Option B (API-based, easiest):
    - Call Cohere Rerank API: cohere.rerank(model="rerank-english-v3.0", ...)
    - Reliable, no GPU needed, ~$1 per 1,000 queries

  The function signature below is identical for both options.
"""
from __future__ import annotations


async def rerank(
    query: str,
    candidates: list[dict],
    top_n: int = 5,
) -> list[dict]:
    """
    Re-score candidate chunks with a cross-encoder.

    Input:  candidates from retriever — list of {"chunk_id", "text", "score", ...}
    Output: top_n candidates re-ordered by cross-encoder relevance score

    STUB — raises NotImplementedError until Week 3.
    """
    raise NotImplementedError("Cross-encoder reranker not implemented yet — Week 3.")
