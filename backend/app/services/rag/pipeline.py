"""
RAG pipeline orchestrator — FREE stack.

Identical logic to the paid version — only the services underneath changed:
  retrieve()        → ChromaDB dense + BM25 sparse + RRF
  rerank()          → cross-encoder/ms-marco-MiniLM-L-6-v2  (local CPU)
  generate_answer() → Groq Llama 3.1 70B  (free API)

Every query is written to query_logs (immutable audit trail).
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
    End-to-end RAG pipeline (free stack):
      retrieve → rerank → generate → log → return
    """
    from app.db.models import QueryLog
    from app.db.schemas import QueryResponse, SourceReference, CitationDetail
    from app.services.rag.retriever import retrieve
    from app.services.rag.reranker import rerank
    from app.services.rag.generator import generate_answer

    if not settings.GROQ_API_KEY:
        raise RuntimeError(
            "GROQ_API_KEY is not set in backend/.env. "
            "Get a free key at https://console.groq.com"
        )

    t_start = time.perf_counter()

    # ── 1. Retrieve ───────────────────────────────────────────────────────────
    try:
        candidates = await retrieve(request, db, top_k=request.top_k or settings.RETRIEVER_TOP_K)
    except Exception as exc:
        log.exception("Retrieval failed: %s", exc)
        raise RuntimeError(f"Retrieval failed: {exc}") from exc

    if not candidates:
        latency_ms = int((time.perf_counter() - t_start) * 1000)
        return await _empty_response(request, user_id, db, latency_ms)

    # ── 2. Rerank ─────────────────────────────────────────────────────────────
    try:
        reranked = await rerank(
            query=request.query,
            candidates=candidates,
            top_n=settings.RERANKER_TOP_N,
        )
    except Exception as exc:
        log.warning("Reranker failed — using RRF order: %s", exc)
        reranked = candidates[:settings.RERANKER_TOP_N]
        for c in reranked:
            c["rerank_score"] = c.get("rrf_score", 0.0)

    # ── 3. Generate ───────────────────────────────────────────────────────────
    try:
        generation = await generate_answer(
            query=request.query,
            reranked_chunks=reranked,
            model=settings.GROQ_MODEL,
        )
    except Exception as exc:
        log.exception("Generation failed: %s", exc)
        raise RuntimeError(f"Answer generation failed: {exc}") from exc

    latency_ms = int((time.perf_counter() - t_start) * 1000)

    # ── 4. Write audit log ────────────────────────────────────────────────────
    query_log = QueryLog(
        user_id=user_id,
        workspace_id=request.workspace_id,
        query_text=request.query,
        answer_text=generation["answer"],
        confidence_score=generation["confidence"],
        source_chunk_ids=json.dumps([s["chunk_id"] for s in generation["sources"]]),
        source_doc_ids=json.dumps(
            list({s["document_id"] for s in generation["sources"]})
        ),
        latency_ms=latency_ms,
        model_used=generation["model_used"],
    )
    db.add(query_log)
    await db.commit()

    # ── 5. Comprehensive audit logging (PostgreSQL analytics summary) ──────────
    try:
        from app.services.audit import write_comprehensive_audit_log

        await write_comprehensive_audit_log(
            query_log_id=query_log.id,
            user_id=user_id,
            workspace_id=request.workspace_id,
            query_text=request.query,
            answer_text=generation["answer"],
            confidence_score=generation["confidence"],
            source_chunk_ids=[s["chunk_id"] for s in generation["sources"]],
            source_doc_ids=list({s["document_id"] for s in generation["sources"]}),
            latency_ms=latency_ms,
            model_used=generation["model_used"],
            sources=generation["sources"],
            citations=generation["citations"],
            db=db,
        )
        await db.commit()   # persist AnalyticsSummary row added by audit helper
    except Exception as exc:
        # Never fail the request over analytics logging
        log.warning("Comprehensive audit logging failed: %s", exc)

    log.info(
        "Pipeline complete: workspace=%s latency_ms=%d confidence=%.2f model=%s",
        request.workspace_id, latency_ms,
        generation["confidence"], generation["model_used"],
    )

    return QueryResponse(
        query_log_id=query_log.id,
        query=request.query,
        answer=generation["answer"],
        confidence=generation["confidence"],
        citations=[
            CitationDetail(
                chunk_id=c["chunk_id"],
                page_number=c.get("page_number"),
                excerpt=c["excerpt"],
                document_name=c["document_name"],
            )
            for c in generation["citations"]
        ],
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


async def _empty_response(request, user_id, db, latency_ms):
    from app.db.models import QueryLog
    from app.db.schemas import QueryResponse

    msg = "No relevant documents found in your workspace for this query."
    query_log = QueryLog(
        user_id=user_id,
        workspace_id=request.workspace_id,
        query_text=request.query,
        answer_text=msg,
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
        answer=msg,
        confidence=0.0,
        citations=[],  # Empty list for structured citations
        sources=[],
        latency_ms=latency_ms,
        model_used="none",
    )
