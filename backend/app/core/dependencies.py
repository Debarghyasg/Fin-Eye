"""
FastAPI dependency injection.

  get_db()            — yields an async SQLAlchemy session
  get_current_user()  — validates Clerk JWT, upserts user row, returns User ORM object
  get_current_user_id() — lightweight variant that returns just the Clerk user_id string
"""
from __future__ import annotations

from typing import AsyncGenerator

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import extract_user_email, extract_user_id, verify_clerk_token
from app.db.models import User
from app.db.session import AsyncSessionLocal

# ── Reusable bearer scheme (auto-generates 401 on missing header) ─────────────
_bearer = HTTPBearer(auto_error=True)


# ── Database session ──────────────────────────────────────────────────────────
async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """
    Yield a transactional async database session.
    Commits on clean exit, rolls back on exception.
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


# ── Auth dependencies ─────────────────────────────────────────────────────────
async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    """
    Full auth dependency:
      1. Verify Clerk JWT.
      2. Extract clerk_user_id from `sub` claim.
      3. Upsert a User row (first sign-in creates the record).
      4. Return the ORM User object.

    Raises HTTP 401 on any auth failure.
    """
    exc_401 = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = await verify_clerk_token(credentials.credentials)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e),
            headers={"WWW-Authenticate": "Bearer"},
        ) from e

    clerk_user_id = extract_user_id(payload)
    email = extract_user_email(payload)

    # Upsert: find existing user or create on first login
    result = await db.execute(select(User).where(User.clerk_user_id == clerk_user_id))
    user = result.scalar_one_or_none()

    if user is None:
        user = User(
            clerk_user_id=clerk_user_id,
            email=email or "",
        )
        db.add(user)
        await db.flush()  # get auto-generated id without committing yet

    return user


async def get_current_user_id(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
) -> str:
    """
    Lightweight dependency — verifies the JWT and returns only the clerk_user_id.
    Use this when you don't need the full User ORM row (e.g. analytics endpoints).
    """
    try:
        payload = await verify_clerk_token(credentials.credentials)
        return extract_user_id(payload)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e),
            headers={"WWW-Authenticate": "Bearer"},
        ) from e
