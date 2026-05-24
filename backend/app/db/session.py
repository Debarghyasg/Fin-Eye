"""
Async SQLAlchemy engine + session factory.

All database I/O in the app uses AsyncSession.
Alembic uses the *sync* URL (psycopg2) defined in alembic/env.py.
"""
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings

# ── Engine ────────────────────────────────────────────────────────────────────
engine = create_async_engine(
    settings.DATABASE_URL,
    pool_size=settings.DB_POOL_SIZE,
    max_overflow=settings.DB_MAX_OVERFLOW,
    pool_timeout=settings.DB_POOL_TIMEOUT,
    pool_pre_ping=True,   # detect stale connections
    echo=settings.DEBUG,  # SQL logging in dev only
)

# ── Session factory ───────────────────────────────────────────────────────────
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,   # avoid lazy-load errors after commit
    autoflush=False,
    autocommit=False,
)


# ── Declarative base shared by all models ─────────────────────────────────────
class Base(DeclarativeBase):
    """
    All SQLAlchemy ORM models inherit from this.
    Alembic's env.py imports Base.metadata for autogenerate.
    """
    pass
