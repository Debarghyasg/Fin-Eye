"""
FinSight AI — FastAPI application entry point.

Startup sequence
----------------
1. Validate settings (Pydantic raises on missing required vars)
2. Run Alembic migrations to head (safe on every deploy)
3. Ensure S3 bucket + SQS queue exist (idempotent)
4. Mount all API routers under /api/v1
5. Serve

Shutdown sequence
-----------------
1. Dispose SQLAlchemy async engine (drain connection pool)
"""
from __future__ import annotations

import logging
import sys
from contextlib import asynccontextmanager
from typing import AsyncGenerator

import structlog
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import settings

# ── Structured logging setup ──────────────────────────────────────────────────
structlog.configure(
    processors=[
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.JSONRenderer(),
    ],
    wrapper_class=structlog.stdlib.BoundLogger,
    logger_factory=structlog.stdlib.LoggerFactory(),
    cache_logger_on_first_use=True,
)

logging.basicConfig(
    stream=sys.stdout,
    level=getattr(logging, settings.LOG_LEVEL, logging.INFO),
    format="%(message)s",
)

log = structlog.get_logger(__name__)


# ── Lifespan (replaces on_event startup/shutdown) ─────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """
    Code before `yield` runs at startup.
    Code after `yield` runs at shutdown.
    """
    # ── Startup ───────────────────────────────────────────────────────────────
    log.info(
        "starting_up",
        app=settings.APP_NAME,
        version=settings.APP_VERSION,
        env=settings.ENVIRONMENT,
    )

    # Run Alembic migrations programmatically so every deploy is always at HEAD.
    # Safe to call when already up-to-date (no-op).
    try:
        import asyncio
        from alembic import command
        from alembic.config import Config as AlembicConfig

        def _run_migrations() -> None:
            alembic_cfg = AlembicConfig("alembic.ini")
            alembic_cfg.set_main_option("sqlalchemy.url", settings.sync_database_url)
            command.upgrade(alembic_cfg, "head")

        await asyncio.to_thread(_run_migrations)
        log.info("migrations_applied")
    except Exception as exc:
        log.error("migration_failed", error=str(exc))
        # Don't crash — DB may already be up to date in some envs
        # (e.g. running tests against an in-memory DB)

    # Ensure S3 bucket exists (if enabled)
    if settings.USE_S3:
        try:
            import asyncio
            from app.services.aws.s3 import ensure_bucket_exists
            await asyncio.to_thread(ensure_bucket_exists)
            log.info("s3_bucket_ready", bucket=settings.S3_BUCKET_NAME)
        except Exception as exc:
            log.warning("s3_bucket_check_failed", error=str(exc))

    # Ensure SQS queue exists (if enabled)
    if settings.USE_SQS:
        try:
            import asyncio
            from app.services.aws.sqs import ensure_queue_exists
            await asyncio.to_thread(ensure_queue_exists)
            log.info("sqs_queue_ready")
        except Exception as exc:
            log.warning("sqs_queue_check_failed", error=str(exc))

    # Ensure DynamoDB audit table exists (if enabled)
    if settings.USE_DYNAMODB:
        try:
            import asyncio
            from app.services.aws.dynamodb import ensure_audit_table_exists
            await asyncio.to_thread(ensure_audit_table_exists)
            log.info("dynamodb_audit_table_ready", table=settings.DYNAMODB_AUDIT_TABLE)
        except Exception as exc:
            log.warning("dynamodb_audit_check_failed", error=str(exc))

    yield  # ← app is now serving requests

    # ── Shutdown ──────────────────────────────────────────────────────────────
    log.info("shutting_down")
    from app.db.session import engine
    await engine.dispose()
    log.info("db_pool_disposed")


# ── Application factory ───────────────────────────────────────────────────────
def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.APP_NAME,
        version=settings.APP_VERSION,
        description=(
            "Production-grade financial document intelligence platform. "
            "Query 10-Ks, earnings calls, and SEC filings with cited answers, "
            "anomaly detection, and full audit trails."
        ),
        docs_url="/docs" if settings.ENVIRONMENT != "production" else None,
        redoc_url="/redoc" if settings.ENVIRONMENT != "production" else None,
        openapi_url="/openapi.json" if settings.ENVIRONMENT != "production" else None,
        lifespan=lifespan,
    )

    # ── CORS ──────────────────────────────────────────────────────────────────
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Accept"],
        expose_headers=["X-Request-ID"],
    )

    # ── Request ID middleware (simple, no external dep) ───────────────────────
    @app.middleware("http")
    async def add_request_id(request: Request, call_next):  # type: ignore[return]
        import uuid
        request_id = str(uuid.uuid4())
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response

    # ── Global exception handlers ─────────────────────────────────────────────
    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        log.error("unhandled_exception", path=str(request.url), error=str(exc), exc_info=exc)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"detail": "An unexpected error occurred. Please try again."},
        )

    # ── Routers ───────────────────────────────────────────────────────────────
    from app.api.routes.auth import router as auth_router
    from app.api.routes.documents import router as documents_router
    from app.api.routes.queries import router as queries_router
    from app.api.routes.analytics import router as analytics_router
    from app.api.routes.comparisons import router as comparisons_router

    prefix = settings.API_V1_PREFIX

    app.include_router(auth_router,        prefix=prefix)
    app.include_router(documents_router,   prefix=prefix)
    app.include_router(queries_router,     prefix=prefix)
    app.include_router(analytics_router,   prefix=prefix)
    app.include_router(comparisons_router, prefix=prefix)

    # ── Root ping (no auth — used by Docker healthcheck) ─────────────────────
    @app.get("/", include_in_schema=False)
    async def root() -> dict:
        return {"service": settings.APP_NAME, "version": settings.APP_VERSION, "status": "ok"}

    log.info(
        "app_created",
        routes=[r.path for r in app.routes],
    )
    return app


# ── Module-level app instance (used by uvicorn and tests) ─────────────────────
app = create_app()
