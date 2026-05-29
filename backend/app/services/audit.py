"""
Audit logging service — PostgreSQL only.

All audit data is written to PostgreSQL (``query_logs`` and ``audit_logs``
tables).  No external services (DynamoDB, etc.) are used.

Public API
----------
  write_comprehensive_audit_log(...)  — write analytics summary to PG after a RAG query
  get_workspace_analytics(...)        — aggregate query stats from query_logs
  get_user_audit_trail(...)           — user-scoped audit trail from query_logs
  record_audit_event(...)             — append a row to audit_logs (SEC 17a-4)
"""
from __future__ import annotations

import logging
from typing import TYPE_CHECKING

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
    """Write an analytics summary row to PostgreSQL after a RAG query.

    The primary audit record (``query_logs``) is already committed by the
    pipeline before this is called.  This function adds the aggregated
    ``analytics_summary`` row that powers the dashboard stats queries.
    """
    await _write_analytics_summary(
        query_log_id, workspace_id, sources, citations, db
    )


async def _write_analytics_summary(
    query_log_id: str,
    workspace_id: str,
    sources: list[dict],
    citations: list[dict],
    db: "AsyncSession",
) -> None:
    """Insert an analytics_summary row for the given query_log."""
    try:
        from app.db.models import AnalyticsSummary

        unique_documents = len(
            {s.get("document_id") for s in sources if s.get("document_id")}
        )
        avg_source_score = (
            sum(s.get("score", 0.0) for s in sources) / len(sources)
            if sources else 0.0
        )

        summary = AnalyticsSummary(
            query_log_id=query_log_id,
            workspace_id=workspace_id,
            source_count=len(sources),
            citation_count=len(citations),
            unique_documents=unique_documents,
            avg_source_score=avg_source_score,
        )
        db.add(summary)
        # Caller owns the transaction — no commit here.
    except Exception as exc:
        log.warning("Analytics summary insert failed: %s", exc)


# ── Analytics helpers ─────────────────────────────────────────────────────────
async def get_workspace_analytics(workspace_id: str, days: int = 30) -> dict:
    """Return aggregate query stats for a workspace from PostgreSQL."""
    postgres_stats = await _get_postgres_analytics(workspace_id, days)
    return {
        "workspace_id": workspace_id,
        "days": days,
        "postgres": postgres_stats,
    }


async def _get_postgres_analytics(workspace_id: str, days: int) -> dict:
    """Aggregate query stats from ``query_logs``.

    Returns a summary dict.  A full implementation would open its own
    DB session; returning a stub structure here keeps the analytics route
    non-blocking while the real aggregation is added in a follow-up.
    """
    return {
        "source": "postgresql",
        "total_queries": 0,
        "avg_confidence": 0.0,
        "model_distribution": {},
        "note": "Pass a db session to compute live stats",
    }


# ── Compliance helpers ────────────────────────────────────────────────────────
async def get_user_audit_trail(
    user_id: str,
    start_date: str | None = None,
    end_date: str | None = None,
    limit: int = 100,
) -> dict:
    """Return a user's audit trail from PostgreSQL ``query_logs``."""
    postgres_logs = await _get_postgres_user_logs(user_id, start_date, end_date, limit)
    return {
        "user_id": user_id,
        "postgres_logs": postgres_logs,
        "total_entries": len(postgres_logs),
    }


async def _get_postgres_user_logs(
    user_id: str,
    start_date: str | None,
    end_date: str | None,
    limit: int,
) -> list[dict]:
    """Placeholder — implement live query against query_logs when needed."""
    return []



# ════════════════════════════════════════════════════════════════════════════
#  Generic action audit logger (PR 1 — SEC Rule 17a-4)
# ════════════════════════════════════════════════════════════════════════════
#  Distinct from the analytics-focused query auditing above:
#  * write_comprehensive_audit_log() captures Q/A pairs in query_logs.
#  * record_audit_event() (below) captures EVERY meaningful action (UPLOAD,
#    DELETE, EXPORT, COMPARE, …) in the dedicated audit_logs table.
#
#  These two layers are intentionally separate. ``query_logs`` is optimised
#  for RAG observability and analytics joins; ``audit_logs`` is optimised for
#  compliance retrieval ("show me everything user X did between dates A and
#  B") and mirrors a DynamoDB partition+sort layout for the production swap.
# ════════════════════════════════════════════════════════════════════════════
from datetime import timedelta
from typing import TYPE_CHECKING, Any

from fastapi import Request

# Avoid circular imports at module load time.
if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession  # noqa: F401  (re-import for type hints)


def _get_request_id(request: Request | None) -> str | None:
    """Extract the request id set by the X-Request-ID middleware in main.py."""
    if request is None:
        return None
    return getattr(request.state, "request_id", None)


def _get_client_ip(request: Request | None) -> str | None:
    """Resolve the originating client IP, honouring X-Forwarded-For when present.

    Order of precedence:
      1. ``request.state.client_ip`` if set by an upstream middleware.
      2. The first hop in ``X-Forwarded-For`` (typical reverse-proxy header).
      3. ``request.client.host`` (direct connection).
    """
    if request is None:
        return None

    cached = getattr(request.state, "client_ip", None)
    if cached:
        return cached

    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        # X-Forwarded-For: client, proxy1, proxy2 → take the first.
        return fwd.split(",")[0].strip() or None

    if request.client is not None:
        return request.client.host

    return None


def _get_user_agent(request: Request | None) -> str | None:
    if request is None:
        return None
    ua = request.headers.get("user-agent")
    return ua[:1024] if ua else None  # cap absurdly long UAs


async def record_audit_event(
    db: "AsyncSession",
    *,
    action: str,
    resource_type: str,
    resource_id: str | None = None,
    user_id: str | None = None,
    workspace_id: str | None = None,
    request: Request | None = None,
    status_code: int | None = None,
    metadata: dict[str, Any] | None = None,
) -> str:
    """Insert an immutable row into ``audit_logs``.

    Always called from inside a request handler that already holds an
    ``AsyncSession``. The caller's transaction commit semantics are honoured —
    we ``flush`` here to fail fast if the row is invalid, but never commit so
    that the audit row is rolled back together with the underlying business
    operation if the latter fails.

    Parameters
    ----------
    action
        Verb describing what happened. Convention: UPPER_SNAKE. Standard
        values: ``QUERY``, ``UPLOAD``, ``DOWNLOAD``, ``DELETE``, ``UPDATE``,
        ``EXPORT``, ``COMPARE``, ``LOGIN``, ``ALERT_VIEW``, ``ALERT_ACK``.
    resource_type
        Lowercase entity name. Standard values: ``document``, ``query``,
        ``workspace``, ``comparison``, ``alert``, ``subscription``, ``user``.
    metadata
        Free-form JSON payload — serialised to JSONB on Postgres. Use this
        for action-specific fields like ``{"filename": ..., "size": ...}``
        that don't deserve a dedicated column.

    Returns
    -------
    str
        The id of the inserted audit row, useful for trace correlation.
    """
    # Local imports avoid the circular `audit.py → models → audit.py` cycle that
    # would arise if we imported AuditLog at module top.
    from datetime import datetime, timezone

    from app.core.config import settings
    from app.db.models import AuditLog

    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(days=365 * settings.AUDIT_LOG_RETENTION_YEARS)

    row = AuditLog(
        workspace_id=workspace_id,
        user_id=user_id,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        ip_address=_get_client_ip(request),
        user_agent=_get_user_agent(request),
        request_id=_get_request_id(request),
        status_code=status_code,
        audit_metadata=metadata,
        created_at=now,
        expires_at=expires_at,
    )
    db.add(row)
    await db.flush()  # surface FK / NOT-NULL violations immediately

    log.debug(
        "audit_event recorded id=%s action=%s resource=%s/%s user=%s ws=%s",
        row.id, action, resource_type, resource_id, user_id, workspace_id,
    )
    return row.id
