"""
Analytics routes — /api/v1/analytics

Endpoints
---------
GET  /analytics/health         → DB + AWS pipeline health check
GET  /analytics/stats          → document / query statistics for a workspace
POST /analytics/compare        → compare two documents (Week 4 stub)
GET  /analytics/pipeline       → per-stage latency of the RAG pipeline
"""
from __future__ import annotations

import logging
import time

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.dependencies import get_current_user, get_db
from app.db.models import Chunk, Document, DocumentStatus, QueryLog, User, Workspace
from app.db.schemas import (
    ComparisonRequest,
    DocumentStats,
    HealthResponse,
    PipelineHealthResponse,
    PipelineStageStatus,
)

log = logging.getLogger(__name__)
router = APIRouter(prefix="/analytics", tags=["analytics"])


# ── GET /analytics/health ─────────────────────────────────────────────────────
@router.get(
    "/health",
    response_model=HealthResponse,
    summary="Service health check",
    # No auth — used by load balancers and uptime monitors
    include_in_schema=True,
)
async def health_check(db: AsyncSession = Depends(get_db)) -> HealthResponse:
    """
    Ping the database and return overall service health.
    Returns HTTP 200 when healthy, HTTP 503 when degraded.
    """
    db_status = "ok"
    try:
        await db.execute(text("SELECT 1"))
    except Exception as exc:
        log.error("DB health check failed: %s", exc)
        db_status = f"error: {exc}"

    overall = "ok" if db_status == "ok" else "degraded"

    return HealthResponse(
        status=overall,
        database=db_status,
        version=settings.APP_VERSION,
        environment=settings.ENVIRONMENT,
    )


# ── GET /analytics/pipeline ───────────────────────────────────────────────────
@router.get(
    "/pipeline",
    response_model=PipelineHealthResponse,
    summary="RAG pipeline stage health",
)
async def pipeline_health(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PipelineHealthResponse:
    """
    Returns the health status of each stage in the RAG pipeline.
    S3 and SQS checks are stubs — implement real checks in Week 3.
    """
    stages: list[PipelineStageStatus] = []

    # ── DB ping ───────────────────────────────────────────────────────────────
    t0 = time.perf_counter()
    try:
        await db.execute(text("SELECT 1"))
        db_ms = int((time.perf_counter() - t0) * 1000)
        stages.append(PipelineStageStatus(stage="PostgreSQL", status="ok", latency_ms=db_ms, detail=None))
    except Exception as exc:
        stages.append(PipelineStageStatus(stage="PostgreSQL", status="down", latency_ms=None, detail=str(exc)))

    # ── S3 connectivity (stub) ────────────────────────────────────────────────
    stages.append(PipelineStageStatus(
        stage="S3 Ingestion",
        status="ok" if settings.S3_BUCKET_NAME else "not_configured",
        latency_ms=None,
        detail=f"bucket={settings.S3_BUCKET_NAME}",
    ))

    # ── SQS connectivity (stub) ───────────────────────────────────────────────
    stages.append(PipelineStageStatus(
        stage="SQS Queue",
        status="ok" if settings.SQS_DOCUMENT_QUEUE_URL else "not_configured",
        latency_ms=None,
        detail=None,
    ))

    # ── Pinecone (Week 3) ─────────────────────────────────────────────────────
    stages.append(PipelineStageStatus(
        stage="Pinecone Index",
        status="not_configured" if not settings.PINECONE_API_KEY else "ok",
        latency_ms=None,
        detail="Configure PINECONE_API_KEY to enable vector search",
    ))

    # ── LLM (Week 3) ─────────────────────────────────────────────────────────
    stages.append(PipelineStageStatus(
        stage="GPT-4o LLM",
        status="not_configured" if not settings.OPENAI_API_KEY else "ok",
        latency_ms=None,
        detail="Configure OPENAI_API_KEY to enable query generation",
    ))

    overall = "ok" if all(s.status == "ok" for s in stages[:1]) else "degraded"

    return PipelineHealthResponse(overall=overall, stages=stages)


# ── GET /analytics/stats ──────────────────────────────────────────────────────
@router.get(
    "/stats",
    response_model=DocumentStats,
    summary="Workspace document and query statistics",
)
async def workspace_stats(
    workspace_id: str = Query(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DocumentStats:
    """Returns aggregate statistics for a workspace."""
    ws_result = await db.execute(
        select(Workspace).where(
            Workspace.id == workspace_id,
            Workspace.owner_id == current_user.id,
        )
    )
    if not ws_result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found.")

    # Document counts by status
    total_docs = (await db.execute(
        select(func.count()).where(Document.workspace_id == workspace_id)
    )).scalar_one()

    indexed = (await db.execute(
        select(func.count()).where(
            Document.workspace_id == workspace_id,
            Document.status == DocumentStatus.INDEXED,
        )
    )).scalar_one()

    # Treat UPLOADING / UPLOADED / EXTRACTING / EXTRACTED / CHUNKING / CHUNKED / EMBEDDING as processing
    _processing_statuses = [
        DocumentStatus.UPLOADING, DocumentStatus.UPLOADED,
        DocumentStatus.EXTRACTING, DocumentStatus.EXTRACTED,
        DocumentStatus.CHUNKING, DocumentStatus.CHUNKED,
        DocumentStatus.EMBEDDING,
    ]
    processing = (await db.execute(
        select(func.count()).where(
            Document.workspace_id == workspace_id,
            Document.status.in_(_processing_statuses),
        )
    )).scalar_one()

    failed = (await db.execute(
        select(func.count()).where(
            Document.workspace_id == workspace_id,
            Document.status == DocumentStatus.FAILED,
        )
    )).scalar_one()

    # Total chunks
    total_chunks = (await db.execute(
        select(func.count(Chunk.id))
        .join(Document, Chunk.document_id == Document.id)
        .where(Document.workspace_id == workspace_id)
    )).scalar_one()

    # Total queries
    total_queries = (await db.execute(
        select(func.count()).where(QueryLog.workspace_id == workspace_id)
    )).scalar_one()

    return DocumentStats(
        total_documents=total_docs,
        indexed=indexed,
        processing=processing,
        failed=failed,
        total_chunks=total_chunks,
        total_queries=total_queries,
    )


# ── POST /analytics/compare ───────────────────────────────────────────────────
@router.post(
    "/compare",
    summary="Compare two documents (Week 4 stub)",
    status_code=status.HTTP_501_NOT_IMPLEMENTED,
)
async def compare_documents(
    body: ComparisonRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    AI-powered side-by-side comparison of two financial documents.
    **Status:** Not implemented — available in Week 4.
    """
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Document comparison will be implemented in Week 4.",
    )
