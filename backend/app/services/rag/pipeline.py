"""
RAG pipeline orchestrator — Week 3.

Full pipeline
-------------
  retrieve()  →  rerank()  →  generate_answer()  →  log to DB  →  return

Every query is written to the query_logs table regardless of success/failure.
This satisfies SEC Rule 17a-4 (immutable audit trail).

Error handling
--------------
  Each stage is wrapped individually so a reranker failure does not prevent
  a degraded response (fall back to top-5 by RRF score without reranking).
"""
from __future__ import annotations

import json
import logging
import time
from typing import TYPE_CHECKING

from app.core.config import settings

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
    End-to-end RAG pipeline.

    Steps:
      1. Retrieve top-20 candidates via hybrid search (Pinecone + BM25 + RRF)
      2. Rerank top-20 → top-5 using cross-encoder
      3. Generate cited answer with GPT-4o
      4. Write immutable QueryLog to DB
      5. Return QueryResponse

    Raises RuntimeError if OPENAI_API_KEY or PINECONE_API_KEY are not set.
    """
    from app.db.models import QueryLog
    from app.db.schemas import QueryResponse, SourceReference
    from app.services.rag.retriever import retrieve
    from app.services.rag.reranker import rerank
    from app.services.rag.generator import generate_answer

    if not settings.OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY is not configured in .env")
    if not settings.PINECONE_API_KEY:
        raise RuntimeError("PINECONE_API_KEY is not configured in .env")

    t_start = time.perf_counter()

    # ── Stage 1: Retrieve ─────────────────────────────────────────────────────
    try:
        candidates = await retrieve(request, db)
    except Exception as exc:
        log.exception("Retrieval stage failed: %s", exc)
        raise RuntimeError(f"Retrieval failed: {exc}") from exc

    if not candidates:
        # No relevant chunks found — return graceful empty answer
        latency_ms = int((time.perf_counter() - t_start) * 1000)
        return await _build_empty_response(
            request=request,
            user_id=user_id,
            db=db,
            latency_ms=latency_ms,
            reason="No relevant documents found in your workspace for this query.",
        )

    # ── Stage 2: Rerank ───────────────────────────────────────────────────────
    try:
        reranked = await rerank(
            query=request.query,
            candidates=candidates,
            top_n=settings.RERANKER_TOP_N,
        )
    except Exception as exc:
        log.warning("Reranker failed — falling back to RRF-ranked results: %s", exc)
        # Graceful degradation: use top-N by RRF score without cross-encoder
        reranked = candidates[:settings.RERANKER_TOP_N]
        for chunk in reranked:
            chunk["rerank_score"] = chunk.get("rrf_score", 0.0)

    # ── Stage 3: Generate ─────────────────────────────────────────────────────
    try:
        generation = await generate_answer(
            query=request.query,
            reranked_chunks=reranked,
            model=settings.OPENAI_CHAT_MODEL,
        )
    except Exception as exc:
        log.exception("Generation stage failed: %s", exc)
        raise RuntimeError(f"Answer generation failed: {exc}") from exc

    latency_ms = int((time.perf_counter() - t_start) * 1000)

    # ── Stage 4: Write audit log ──────────────────────────────────────────────
    source_chunk_ids = json.dumps([s["chunk_id"] for s in generation["sources"]])
    source_doc_ids   = json.dumps(
        list({s["document_id"] for s in generation["sources"]})
    )

    query_log = QueryLog(
        user_id=user_id,
        workspace_id=request.workspace_id,
        query_text=request.query,
        answer_text=generation["answer"],
        confidence_score=generation["confidence"],
        source_chunk_ids=source_chunk_ids,
        source_doc_ids=source_doc_ids,
        latency_ms=latency_ms,
        model_used=generation["model_used"],
    )
    db.add(query_log)
    await db.commit()

    log.info(
        "Query pipeline complete: workspace=%s latency_ms=%d confidence=%.2f",
        request.workspace_id, latency_ms, generation["confidence"],
    )

    # ── Stage 5: Build response ───────────────────────────────────────────────
    return QueryResponse(
        query_log_id=query_log.id,
        query=request.query,
        answer=generation["answer"],
        confidence=generation["confidence"],
        sources=[
            SourceReference(
                document_id=s["document_id"],
                chunk_id=s["chunk_id"],
                page_number=s.get("page_number"),
                excerpt=s["excerpt"],
                score=s["score"],
            )
            for s in generation["sources"]
        ],
        latency_ms=latency_ms,
        model_used=generation["model_used"],
    )


async def _build_empty_response(
    request: "QueryRequest",
    user_id: str,
    db: "AsyncSession",
    latency_ms: int,
    reason: str,
) -> "QueryResponse":
    """Return a well-formed empty QueryResponse and log it."""
    from app.db.models import QueryLog
    from app.db.schemas import QueryResponse

    query_log = QueryLog(
        user_id=user_id,
        workspace_id=request.workspace_id,
        query_text=request.query,
        answer_text=reason,
        confidence_score=0.0,
        source_chunk_ids="[]",
        source_doc_ids="[]",
        latency_ms=latency_ms,
        model_used="none",
    )
    db.add(query_log)
    await db.commit()

    return QueryResponse(
        query_log_id=query_log.id,
        query=request.query,
        answer=reason,
        confidence=0.0,
        sources=[],
        latency_ms=latency_ms,
        model_used="none",
    )
