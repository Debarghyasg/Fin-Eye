"""
pytest configuration and shared fixtures.

Test strategy
-------------
- Use an in-memory SQLite DB (via aiosqlite) for unit tests so no Postgres needed.
- Use httpx.AsyncClient with ASGITransport to test routes end-to-end.
- Mock AWS calls (S3, SQS, Comprehend) with pytest-mock / moto.
- Override get_current_user to inject a test user without a real Clerk JWT.
- Force Celery into eager mode so process_document.delay() runs inline
  without needing a real RabbitMQ broker.

Install test extras:
    pip install pytest pytest-asyncio httpx aiosqlite moto[s3,sqs]
"""
from __future__ import annotations

import os

# Force Celery eager BEFORE the app imports settings (Pydantic caches them).
# Tasks dispatched via .delay() will execute inline in the test process.
os.environ.setdefault("CELERY_TASK_ALWAYS_EAGER", "true")
# Tests do not need a real RabbitMQ; eager mode bypasses the broker, but
# Celery still parses the URL so keep it pointing at a harmless local default.
os.environ.setdefault("CELERY_BROKER_URL", "memory://")
os.environ.setdefault("CELERY_RESULT_BACKEND", "cache+memory://")

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.db.session import Base
from app.main import create_app

# ── In-memory async SQLite engine ─────────────────────────────────────────────
TEST_DB_URL = "sqlite+aiosqlite:///:memory:"


@pytest_asyncio.fixture(scope="session")
async def engine():
    eng = create_async_engine(TEST_DB_URL, echo=False)
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield eng
    await eng.dispose()


@pytest_asyncio.fixture
async def db_session(engine):
    session_factory = async_sessionmaker(
        bind=engine, class_=AsyncSession, expire_on_commit=False
    )
    async with session_factory() as session:
        yield session
        await session.rollback()


@pytest_asyncio.fixture
async def client(db_session):
    """
    HTTP test client with dependency overrides:
    - DB session → in-memory SQLite session
    - Auth → stub user (no real Clerk JWT needed)
    """
    from app.core.dependencies import get_current_user, get_db
    from app.db.models import User

    stub_user = User(
        id="test-user-id",
        clerk_user_id="user_test123",
        email="test@finsight.ai",
        full_name="Test Analyst",
    )

    async def _stub_db():
        yield db_session

    async def _stub_user():
        return stub_user

    app = create_app()
    app.dependency_overrides[get_db] = _stub_db
    app.dependency_overrides[get_current_user] = _stub_user

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as ac:
        yield ac
