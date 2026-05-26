"""
Comprehensive audit logging service.

Implements dual-layer logging:
1. PostgreSQL (query_logs table) - primary audit trail, required
2. DynamoDB - enhanced audit with analytics metadata, optional

Every RAG query writes to both systems for compliance and analytics.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import TYPE_CHECKING

from app.core.config import settings

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

log = logging.getLogger(__name__)


async def write_comprehensive_audit_log(
    query_log_id: str,
    user_id: str,
    workspace_id: str,
    query_text: str,
    answer_text: str,
    confidence_score: float,
    source_chunk_ids: list[str],
    source_doc_ids: list[str],
    latency_ms: int,
    model_used: str,
    sources: list[dict],
    citations: list[dict],
    db: "AsyncSession",
) -> None:
    """
    Write comprehensive audit log to both PostgreSQL and DynamoDB.
    
    PostgreSQL: Required, primary audit trail (already handled by pipeline)
    DynamoDB: Optional, enhanced with analytics metadata
    """
    # PostgreSQL logging is already handled in the pipeline
    # Here we add the DynamoDB logging asynchronously
    
    if settings.USE_DYNAMODB:
        try:
            # Run DynamoDB logging in thread pool to avoid blocking
            from app.services.aws.dynamodb import write_audit_log
            
            await asyncio.to_thread(
                write_audit_log,
                query_log_id=query_log_id,
                workspace_id=workspace_id,
                user_id=user_id,
                query_text=query_text,
                answer_text=answer_text,
                confidence_score=confidence_score,
                chunk_ids=source_chunk_ids,
                latency_ms=latency_ms,
                model_used=model_used,
                sources=sources,
                citations=citations,
            )
            
        except Exception as exc:
            # Audit logging should never break the main pipeline
            log.error("DynamoDB audit logging failed: %s", exc)
    
    # Additional analytics summary to PostgreSQL (optional)
    if should_write_analytics_summary():
        await write_analytics_summary(
            query_log_id, workspace_id, sources, citations, db
        )


def should_write_analytics_summary() -> bool:
    """Determine if we should write analytics summary to PostgreSQL."""
    # For now, always write. In production, could be based on sampling rate
    return True


async def write_analytics_summary(
    query_log_id: str,
    workspace_id: str,
    sources: list[dict],
    citations: list[dict],
    db: "AsyncSession",
) -> None:
    """
    Write analytics summary to PostgreSQL queries table.
    
    This supplements the detailed query_logs with aggregated metrics
    for faster analytics queries.
    """
    try:
        from app.db.models import AnalyticsSummary
        
        # Calculate summary metrics
        unique_documents = len(set(s.get("document_id") for s in sources if s.get("document_id")))
        avg_source_score = sum(s.get("score", 0.0) for s in sources) / len(sources) if sources else 0.0
        
        summary = AnalyticsSummary(
            query_log_id=query_log_id,
            workspace_id=workspace_id,
            source_count=len(sources),
            citation_count=len(citations),
            unique_documents=unique_documents,
            avg_source_score=avg_source_score,
        )
        
        db.add(summary)
        # Don't commit here - let the caller handle the transaction
        
    except Exception as exc:
        log.warning("Analytics summary failed: %s", exc)


# ── Analytics helpers ─────────────────────────────────────────────────────────
async def get_workspace_analytics(workspace_id: str, days: int = 30) -> dict:
    """
    Get comprehensive workspace analytics from both data sources.
    
    Combines PostgreSQL and DynamoDB data for rich analytics dashboard.
    """
    postgres_stats = await _get_postgres_analytics(workspace_id, days)
    
    if settings.USE_DYNAMODB:
        try:
            from app.services.aws.dynamodb import get_workspace_query_stats
            dynamodb_stats = await asyncio.to_thread(
                get_workspace_query_stats, workspace_id, days
            )
        except Exception as exc:
            log.warning("DynamoDB analytics failed: %s", exc)
            dynamodb_stats = {"error": str(exc)}
    else:
        dynamodb_stats = {"disabled": True}
    
    return {
        "workspace_id": workspace_id,
        "days": days,
        "postgres": postgres_stats,
        "dynamodb": dynamodb_stats,
    }


async def _get_postgres_analytics(workspace_id: str, days: int) -> dict:
    """Get analytics from PostgreSQL query_logs table."""
    # This would typically use the db session passed from the route
    # For now, return a placeholder structure
    return {
        "source": "postgresql",
        "total_queries": 0,
        "avg_confidence": 0.0,
        "model_distribution": {},
        "note": "Implementation requires db session from route handler"
    }


# ── Compliance helpers ────────────────────────────────────────────────────────
async def get_user_audit_trail(
    user_id: str,
    start_date: str | None = None,
    end_date: str | None = None,
    limit: int = 100
) -> dict:
    """
    Get comprehensive audit trail for regulatory compliance.
    
    Combines data from both PostgreSQL and DynamoDB for complete picture.
    Used for SEC audits, user activity reviews, etc.
    """
    postgres_logs = await _get_postgres_user_logs(user_id, start_date, end_date, limit)
    
    if settings.USE_DYNAMODB:
        try:
            from datetime import datetime
            from app.services.aws.dynamodb import get_user_query_history
            
            start_dt = datetime.fromisoformat(start_date) if start_date else None
            dynamodb_logs = await asyncio.to_thread(
                get_user_query_history, user_id, start_dt, limit
            )
        except Exception as exc:
            log.warning("DynamoDB audit trail failed: %s", exc)
            dynamodb_logs = []
    else:
        dynamodb_logs = []
    
    return {
        "user_id": user_id,
        "postgres_logs": postgres_logs,
        "dynamodb_logs": dynamodb_logs,
        "total_entries": len(postgres_logs) + len(dynamodb_logs)
    }


async def _get_postgres_user_logs(
    user_id: str,
    start_date: str | None,
    end_date: str | None,
    limit: int
) -> list[dict]:
    """Get user logs from PostgreSQL."""
    # Placeholder - would implement actual DB query
    return []