"""
RAG pipeline orchestrator — Week 3 stub.

Full Week 3 implementation:
  1. retriever.py  — hybrid BM25 + Pinecone dense search → top-k candidates
  2. reranker.py   — cross-encoder re-scores candidates → top-n
  3. generator.py  — GPT-4o generates answer with cited sources

The pipeline() function below is the single entry-point called by the
/queries endpoint. Its interface is defined now so the route code needs
no changes in Week 3.
"""
from __future__ import annotations

import logging
import time
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession
    from app.db.schemas import QueryRequest, QueryResponse

log = logging.getLogger(__name__)


async def run_query_pipeline(
    request: "QueryRequest",
    user_id: str,
    db: "AsyncSession",
) -> "QueryResponse":
    """
    End-to-end RAG pipeline:
      retrieve → rerank → generate → log → return

    STUB — raises NotImplementedError until Week 3.
    """
    raise NotImplementedError(
        "RAG pipeline not implemented yet. Implement in Week 3 after "
        "Pinecone is configured and chunk embeddings exist."
    )
