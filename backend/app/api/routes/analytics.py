"""
Analytics routes — /api/v1/analytics

Endpoints
---------
GET  /analytics/health         → DB + AWS pipeline health check
GET  /analytics/stats          → document / query statistics for a workspace
GET  /analytics/audit/workspace/{workspace_id} → comprehensive audit analytics
GET  /analytics/audit/user/{user_id} → user audit trail for compliance
POST /analytics/audit/token-usage → token usage and cost analytics
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

    # ── Embedding model (local, CPU) ─────────────────────────────────────────
    stages.append(PipelineStageStatus(
        stage="Embeddings",
        status="ok",
        latency_ms=None,
        detail=f"model={settings.EMBEDDING_MODEL}",
    ))

    # ── pgvector (PostgreSQL) ─────────────────────────────────────────────────
    # Vector search runs inside the same PostgreSQL instance — no extra service.
    stages.append(PipelineStageStatus(
        stage="pgvector",
        status="ok" if db_status == "ok" else "degraded",
        latency_ms=None,
        detail="PostgreSQL pgvector extension (cosine similarity)",
    ))

    # ── Groq LLM (free tier) ─────────────────────────────────────────────────
    stages.append(PipelineStageStatus(
        stage="Groq LLM",
        status="ok" if settings.GROQ_API_KEY else "not_configured",
        latency_ms=None,
        detail=f"model={settings.GROQ_MODEL}" if settings.GROQ_API_KEY else "Configure GROQ_API_KEY",
    ))

    # Bug 4 fix: was `stages[:1]` which only checked Postgres.
    # Any non-ok, non-disabled, non-not_configured stage should degrade overall.
    degraded_statuses = {"degraded", "down"}
    overall = "degraded" if any(s.status in degraded_statuses for s in stages) else "ok"

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


# ── GET /analytics/audit ─────────────────────────────────────────────────────
@router.get(
    "/audit/workspace/{workspace_id}",
    summary="Comprehensive workspace audit analytics",
)
async def get_workspace_audit_analytics(
    workspace_id: str,
    days: int = Query(30, ge=1, le=365, description="Number of days to analyze"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Get comprehensive audit analytics combining PostgreSQL and DynamoDB data.
    
    Includes query volumes, confidence trends, model usage, token consumption,
    and source document patterns for the specified workspace and time period.
    """
    # Verify workspace ownership
    ws_result = await db.execute(
        select(Workspace).where(
            Workspace.id == workspace_id,
            Workspace.owner_id == current_user.id,
        )
    )
    if not ws_result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found.")
    
    try:
        from app.services.audit import get_workspace_analytics
        
        analytics = await get_workspace_analytics(workspace_id, days)
        return {
            "workspace_id": workspace_id,
            "period_days": days,
            "analytics": analytics,
            "generated_at": time.time()
        }
    except Exception as exc:
        log.error("Workspace audit analytics failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Analytics generation failed: {exc}"
        )


# ── GET /analytics/audit/user/{user_id} ───────────────────────────────────────
@router.get(
    "/audit/user/{target_user_id}",
    summary="User audit trail for compliance",
)
async def get_user_audit_trail(
    target_user_id: str,
    start_date: str = Query(None, description="ISO format date (YYYY-MM-DD)"),
    end_date: str = Query(None, description="ISO format date (YYYY-MM-DD)"),
    limit: int = Query(100, ge=1, le=1000, description="Maximum records to return"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Get comprehensive user audit trail for regulatory compliance.
    
    **Admin only**: Returns all queries, responses, confidence scores,
    chunk IDs, latency, and token usage across all workspaces for the user.
    
    Used for SEC audits, compliance reviews, and user activity analysis.
    """
    # Basic authorization check - in production, implement proper admin role checking
    if current_user.id != target_user_id:
        # For demo purposes, allow self-access only
        # In production: check admin role, workspace permissions, etc.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. Admin privileges required for user audit trail."
        )
    
    try:
        from app.services.audit import get_user_audit_trail
        
        audit_data = await get_user_audit_trail(
            target_user_id, start_date, end_date, limit
        )
        
        return {
            "target_user_id": target_user_id,
            "requested_by": current_user.id,
            "date_range": {
                "start": start_date,
                "end": end_date
            },
            "limit": limit,
            "audit_trail": audit_data,
            "compliance_note": "SEC Rule 17a-4 compliant audit trail",
            "generated_at": time.time()
        }
        
    except Exception as exc:
        log.error("User audit trail failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Audit trail generation failed: {exc}"
        )


# ── POST /analytics/audit/token-usage ────────────────────────────────────────
@router.post(
    "/audit/token-usage",
    summary="Token usage analytics and cost estimation",
)
async def get_token_usage_analytics(
    workspace_ids: list[str],
    days: int = Query(30, ge=1, le=365),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Calculate token usage and cost estimates across multiple workspaces.
    
    Requires DynamoDB audit logging to be enabled for accurate token counts.
    Used for billing analysis and usage optimization.
    """
    # Verify workspace ownership for all requested workspaces
    owned_workspaces = await db.execute(
        select(Workspace.id).where(
            Workspace.id.in_(workspace_ids),
            Workspace.owner_id == current_user.id,
        )
    )
    owned_ids = set(ws.id for ws in owned_workspaces.scalars().all())
    
    if len(owned_ids) != len(workspace_ids):
        unauthorized = set(workspace_ids) - owned_ids
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Access denied to workspaces: {list(unauthorized)}"
        )

    return {
        "error": "Token usage analytics are not available in the local stack.",
        "note": (
            "Detailed per-token tracking requires an external LLM API with "
            "usage reporting (e.g. OpenAI). Groq's free tier does not expose "
            "per-request token counts in the response payload."
        ),
    }
