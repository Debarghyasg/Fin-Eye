"""
Query routes — /api/v1/queries

Endpoints
---------
POST /queries          → run a RAG query (Week 3 — stub returns 501 until pipeline is live)
GET  /queries/history  → paginated query history for the workspace (audit log)
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, get_db
from app.db.models import QueryLog, User, Workspace
from app.db.schemas import PaginatedList, QueryRequest, QueryResponse
from app.services.rag.pipeline import run_query_pipeline

log = logging.getLogger(__name__)
router = APIRouter(prefix="/queries", tags=["queries"])


# ── POST /queries ─────────────────────────────────────────────────────────────
@router.post(
    "",
    response_model=QueryResponse,
    status_code=status.HTTP_200_OK,
    summary="Run a RAG query against indexed documents",
)
async def run_query(
    body: QueryRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> QueryResponse:
    """
    Execute a natural language query against the workspace's indexed documents.

    Returns a cited answer with source references and confidence score.

    **Status:** Stub — returns HTTP 501 until Week 3 (Pinecone + embeddings) is complete.
    """
    # Verify workspace ownership
    ws_result = await db.execute(
        select(Workspace).where(
            Workspace.id == body.workspace_id,
            Workspace.owner_id == current_user.id,
        )
    )
    if not ws_result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found.")

    try:
        return await run_query_pipeline(body, current_user.id, db)
    except NotImplementedError:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail=(
                "RAG pipeline is not yet available. "
                "Complete Week 3 (embeddings + Pinecone) to enable queries."
            ),
        )
    except Exception as exc:
        log.exception("Query pipeline error: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Query failed due to an internal error.",
        ) from exc


# ── GET /queries/history ──────────────────────────────────────────────────────
@router.get(
    "/history",
    response_model=PaginatedList[dict],
    summary="Get query history for a workspace (audit log)",
)
async def get_query_history(
    workspace_id: str = Query(...),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PaginatedList[dict]:
    """
    Returns the immutable query audit log for a workspace.
    Ordered by most recent first.
    SEC Rule 17a-4 compliant — rows are never deleted or modified.
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

    from sqlalchemy import func
    count_result = await db.execute(
        select(func.count()).where(QueryLog.workspace_id == workspace_id)
    )
    total = count_result.scalar_one()

    results = await db.execute(
        select(QueryLog)
        .where(QueryLog.workspace_id == workspace_id)
        .order_by(QueryLog.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    logs = results.scalars().all()

    items = [
        {
            "id": ql.id,
            "query": ql.query_text,
            "answer": ql.answer_text,
            "confidence": ql.confidence_score,
            "latency_ms": ql.latency_ms,
            "model": ql.model_used,
            "created_at": ql.created_at.isoformat(),
        }
        for ql in logs
    ]

    return PaginatedList(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        has_next=(page * page_size) < total,
    )
