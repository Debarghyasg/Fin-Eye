"""
Audit-log routes — /api/v1/audit

Read-only access to the ``audit_logs`` append-only trail required by
SEC Rule 17a-4. Records are workspace-scoped and only visible to the
workspace owner; the response shape mirrors the production DynamoDB
audit table so downstream tooling can be reused.

Endpoints
---------
GET  /audit                — list audit events for a workspace (paginated, filterable)
GET  /audit/{audit_id}     — fetch a single audit event by id

Filtering
---------
The list endpoint supports the standard compliance query pattern
("show me everything user X did, action Y, between dates A and B"):

    /api/v1/audit?workspace_id=...&user_id=...&action=DELETE&since=2026-01-01&until=2026-06-01

Notes
-----
* This is **read-only** by design. There is no DELETE here — the retention
  TTL job (Phase 5) handles purging past expires_at.
* Postgres has a BEFORE UPDATE trigger that makes audit rows immutable at
  the DB level, so even direct SQL cannot mutate them.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, get_db
from app.db.models import AuditLog, User, Workspace
from app.db.schemas import AuditLogOut, PaginatedList

log = logging.getLogger(__name__)
router = APIRouter(prefix="/audit", tags=["audit"])


async def _verify_workspace_owner(
    workspace_id: str, current_user: User, db: AsyncSession
) -> None:
    result = await db.execute(
        select(Workspace).where(
            Workspace.id == workspace_id,
            Workspace.owner_id == current_user.id,
        )
    )
    if result.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workspace not found.",
        )


# ── GET /audit ────────────────────────────────────────────────────────────────
@router.get(
    "",
    response_model=PaginatedList[AuditLogOut],
    summary="List audit events for a workspace (compliance trail)",
)
async def list_audit_events(
    workspace_id: str = Query(..., description="Workspace whose audit trail to read"),
    user_id: Optional[str] = Query(default=None, description="Filter by user"),
    action: Optional[str] = Query(default=None, description="Filter by action verb (UPLOAD, DELETE, ...)"),
    resource_type: Optional[str] = Query(default=None, description="Filter by resource type (document, query, ...)"),
    resource_id: Optional[str] = Query(default=None, description="Filter by resource id"),
    since: Optional[datetime] = Query(default=None, description="Inclusive lower bound on created_at"),
    until: Optional[datetime] = Query(default=None, description="Exclusive upper bound on created_at"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=500),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PaginatedList[AuditLogOut]:
    """
    Paginated audit-log read.

    Only the workspace owner may read the trail. Results are ordered
    newest-first to match the ``ix_audit_logs_workspace_time`` composite
    index.
    """
    await _verify_workspace_owner(workspace_id, current_user, db)

    query = select(AuditLog).where(AuditLog.workspace_id == workspace_id)
    if user_id is not None:
        query = query.where(AuditLog.user_id == user_id)
    if action is not None:
        query = query.where(AuditLog.action == action)
    if resource_type is not None:
        query = query.where(AuditLog.resource_type == resource_type)
    if resource_id is not None:
        query = query.where(AuditLog.resource_id == resource_id)
    if since is not None:
        query = query.where(AuditLog.created_at >= since)
    if until is not None:
        query = query.where(AuditLog.created_at < until)

    # Total count for pagination
    count_result = await db.execute(
        select(func.count()).select_from(query.subquery())
    )
    total = count_result.scalar_one()

    rows = (
        await db.execute(
            query.order_by(AuditLog.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).scalars().all()

    return PaginatedList(
        items=[AuditLogOut.model_validate(r) for r in rows],
        total=total,
        page=page,
        page_size=page_size,
        has_next=(page * page_size) < total,
    )


# ── GET /audit/{audit_id} ─────────────────────────────────────────────────────
@router.get(
    "/{audit_id}",
    response_model=AuditLogOut,
    summary="Fetch a single audit event",
)
async def get_audit_event(
    audit_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AuditLogOut:
    row = (
        await db.execute(select(AuditLog).where(AuditLog.id == audit_id))
    ).scalar_one_or_none()

    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Audit event not found."
        )

    # Authorisation: only the workspace owner may read the event.
    if row.workspace_id is not None:
        await _verify_workspace_owner(row.workspace_id, current_user, db)
    elif row.user_id != current_user.id:
        # Workspace-less rows (rare, e.g. login events) are visible only to
        # the originating user.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to this audit event.",
        )

    return AuditLogOut.model_validate(row)
