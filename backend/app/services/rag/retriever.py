"""
Hybrid retriever — Week 3 stub.

Week 3 implementation plan:
  1. Dense retrieval:
       - Embed the query with text-embedding-3-large
       - Query Pinecone for top-k nearest vectors filtered by workspace_id
         (and optionally document_ids)
  2. Sparse retrieval (BM25):
       - Build a BM25 index over chunk texts per workspace (cached in Redis)
       - Score the query against the BM25 index
  3. Reciprocal Rank Fusion (RRF):
       - Merge dense + sparse ranked lists using RRF formula
       - Return top-k merged candidates to the reranker
"""
from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.db.schemas import QueryRequest


async def retrieve(
    request: "QueryRequest",
    top_k: int = 20,
) -> list[dict]:
    """
    Retrieve candidate chunks using hybrid search.

    Returns a list of candidate dicts:
        [{"chunk_id": "...", "text": "...", "score": 0.92, "metadata": {...}}, ...]

    STUB — raises NotImplementedError until Week 3.
    """
    raise NotImplementedError("Hybrid retriever not implemented yet — Week 3.")
