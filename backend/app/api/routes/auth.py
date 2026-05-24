"""
Auth routes — /api/v1/auth

All endpoints require a valid Clerk JWT (Bearer token).

Endpoints
---------
GET  /me            → current user profile
PATCH /me           → update display name / email
GET  /me/workspaces → list all workspaces owned by the current user
POST /me/workspaces → create a new workspace
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, get_db
from app.db.models import User, Workspace
from app.db.schemas import UserOut, UserUpdate, WorkspaceCreate, WorkspaceOut

router = APIRouter(prefix="/auth", tags=["auth"])


# ── GET /me ───────────────────────────────────────────────────────────────────
@router.get("/me", response_model=UserOut, summary="Get current user profile")
async def get_me(current_user: User = Depends(get_current_user)) -> User:
    """
    Returns the authenticated user's profile.

    On the very first call after sign-up, the dependency creates the user row.
    Subsequent calls return the existing record.
    """
    return current_user


# ── PATCH /me ─────────────────────────────────────────────────────────────────
@router.patch("/me", response_model=UserOut, summary="Update user profile")
async def update_me(
    body: UserUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Update the authenticated user's display name and/or email."""
    if body.full_name is not None:
        current_user.full_name = body.full_name
    if body.email is not None:
        current_user.email = str(body.email)
    db.add(current_user)
    return current_user


# ── GET /me/workspaces ────────────────────────────────────────────────────────
@router.get(
    "/me/workspaces",
    response_model=list[WorkspaceOut],
    summary="List current user's workspaces",
)
async def list_my_workspaces(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[WorkspaceOut]:
    """Return all workspaces owned by the authenticated user."""
    result = await db.execute(
        select(Workspace).where(Workspace.owner_id == current_user.id)
    )
    workspaces = result.scalars().all()

    # Enrich with document_count — a simple subquery would be cleaner in Week 3
    out: list[WorkspaceOut] = []
    for ws in workspaces:
        doc_result = await db.execute(
            select(Workspace).where(Workspace.id == ws.id)
        )
        out.append(
            WorkspaceOut(
                id=ws.id,
                owner_id=ws.owner_id,
                name=ws.name,
                description=ws.description,
                is_default=ws.is_default,
                document_count=len(ws.documents) if ws.documents else 0,
                created_at=ws.created_at,
                updated_at=ws.updated_at,
            )
        )
    return out


# ── POST /me/workspaces ───────────────────────────────────────────────────────
@router.post(
    "/me/workspaces",
    response_model=WorkspaceOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new workspace",
)
async def create_workspace(
    body: WorkspaceCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> WorkspaceOut:
    """
    Create a new document workspace for the authenticated user.
    Workspace names must be unique per user.
    """
    # Check uniqueness
    existing = await db.execute(
        select(Workspace).where(
            Workspace.owner_id == current_user.id,
            Workspace.name == body.name,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Workspace named {body.name!r} already exists.",
        )

    ws = Workspace(
        owner_id=current_user.id,
        name=body.name,
        description=body.description,
    )
    db.add(ws)
    await db.flush()

    return WorkspaceOut(
        id=ws.id,
        owner_id=ws.owner_id,
        name=ws.name,
        description=ws.description,
        is_default=ws.is_default,
        document_count=0,
        created_at=ws.created_at,
        updated_at=ws.updated_at,
    )
