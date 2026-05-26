"""
Pydantic Settings — all configuration loaded from environment variables / .env file.
100% free stack — no paid services required.

Free service map
----------------
  LLM          : Groq  (Llama 3.1 70B — 14,400 req/day free)
  Embeddings   : HuggingFace sentence-transformers/all-MiniLM-L6-v2  (local, CPU)
  Vector store : ChromaDB  (runs in Docker, persistent on disk)
  BM25 cache   : Redis  (in Docker)
  File storage : Local filesystem  (Docker volume)
  Queue        : In-process asyncio  (no SQS needed)
  PII scan     : Regex fallback  (no Comprehend needed)
"""
from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── App ───────────────────────────────────────────────────────
    APP_NAME: str = "FinSight AI"
    APP_VERSION: str = "0.1.0"
    ENVIRONMENT: Literal["development", "staging", "production"] = "development"
    DEBUG: bool = False
    LOG_LEVEL: str = "INFO"

    # ── API ───────────────────────────────────────────────────────
    API_V1_PREFIX: str = "/api/v1"
    ALLOWED_ORIGINS: str = "http://localhost:3000,http://127.0.0.1:3000"

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.ALLOWED_ORIGINS.split(",") if o.strip()]

    # ── Database ──────────────────────────────────────────────────
    DATABASE_URL: str = Field(
        default="postgresql+asyncpg://finsight:finsight_dev@localhost:5432/finsight",
    )

    @property
    def sync_database_url(self) -> str:
        return self.DATABASE_URL.replace(
            "postgresql+asyncpg://", "postgresql+psycopg2://"
        )

    DB_POOL_SIZE: int = 10
    DB_MAX_OVERFLOW: int = 20
    DB_POOL_TIMEOUT: int = 30

    # ── PostgreSQL (Docker Compose) ────────────────────────────────
    POSTGRES_USER: str = "finsight"
    POSTGRES_PASSWORD: str = "finsight_dev"
    POSTGRES_DB: str = "finsight"

    # ── Clerk Auth ────────────────────────────────────────────────
    CLERK_SECRET_KEY: str = ""
    CLERK_PUBLISHABLE_KEY: str = ""
    CLERK_JWKS_URL: str = "https://api.clerk.dev/v1/jwks"
    CLERK_JWT_AUDIENCE: str = ""

    # ── FREE: Groq LLM ────────────────────────────────────────────
    # Sign up free at https://console.groq.com
    # Free tier: 14,400 requests/day, 6,000 tokens/min
    GROQ_API_KEY: str = Field(default="", description="gsk_... from console.groq.com")
    GROQ_MODEL: str = "llama-3.1-70b-versatile"   # best free model
    GROQ_FALLBACK_MODEL: str = "llama-3.1-8b-instant"  # faster fallback

    # ── OpenAI (for advanced financial intelligence features) ────────────────
    # GPT-4o for structured financial metrics extraction and analysis
    OPENAI_API_KEY: str = Field(default="", description="OpenAI API key for GPT-4o")
    OPENAI_MODEL: str = "gpt-4o"
    OPENAI_FALLBACK_MODEL: str = "gpt-4o-mini"

    # ── FREE: Local embeddings (HuggingFace) ──────────────────────
    # No account, no API key — runs entirely on CPU in Docker
    # Model downloads ~90 MB on first run, cached in /app/.cache
    EMBEDDING_MODEL: str = "sentence-transformers/all-MiniLM-L6-v2"
    EMBEDDING_DIMENSION: int = 384   # fixed for all-MiniLM-L6-v2

    # ── FREE: Qdrant vector store (PDF §0) ───────────────────────────────────
    # Runs as a service in Docker Compose, data persisted on disk.
    # Production swap to Pinecone Serverless = change QDRANT_URL + QDRANT_API_KEY,
    # no business-logic changes.
    QDRANT_URL: str = "http://localhost:6333"
    QDRANT_API_KEY: str = ""                            # blank for local Qdrant
    QDRANT_COLLECTION: str = "finsight_chunks"
    QDRANT_DENSE_VECTOR_NAME: str = "dense"             # named vector for dense embeddings
    QDRANT_SPARSE_VECTOR_NAME: str = "sparse"           # named vector for BM25 sparse
    QDRANT_SPARSE_MODEL: str = "Qdrant/bm25"            # fastembed sparse model id

    # Legacy ChromaDB settings — kept so existing .env files don't error out.
    # The retriever no longer reads them; remove next major release.
    CHROMA_HOST: str = "localhost"
    CHROMA_PORT: int = 8001
    CHROMA_COLLECTION: str = "finsight_chunks"

    # ── FREE: Redis (cache only — NOT a broker) ──────────────────
    # Used for query-response caching, ticker-cache hot path, and session data.
    # The BM25 index that used to live here is gone — Qdrant stores sparse vectors natively.
    REDIS_URL: str = "redis://localhost:6379/0"
    REDIS_BM25_TTL: int = 604800  # deprecated — kept so legacy .env files load

    # ── FREE: RabbitMQ + Celery (durable async pipeline) ─────────
    # Replaces FastAPI BackgroundTasks for document processing.
    # Production swap: change CELERY_BROKER_URL to an AWS SQS URL.
    CELERY_BROKER_URL: str = "amqp://finsight:finsight_dev@localhost:5672//"
    CELERY_RESULT_BACKEND: str = "rpc://"               # in-broker results, no extra service
    CELERY_TASK_DEFAULT_QUEUE: str = "finsight"
    CELERY_TASK_ALWAYS_EAGER: bool = False              # set True in tests to run inline
    # Celery Beat schedule for the EDGAR poller. Disabled by default; enable
    # by running `celery -A app.services.celery_app beat -l info` plus
    # USE_EDGAR_POLLER=true.
    EDGAR_POLLER_BEAT_NAME: str = "edgar-poll-every-hour"

    # ── FREE: Local file storage ──────────────────────────────────
    # Files stored on Docker volume instead of S3
    # Set USE_S3=true to switch back to real S3 when ready
    USE_S3: bool = False
    LOCAL_STORAGE_PATH: str = "/app/uploads"

    # AWS (optional — only used when USE_S3=true)
    AWS_REGION: str = "us-east-1"
    AWS_ACCESS_KEY_ID: str = "test"
    AWS_SECRET_ACCESS_KEY: str = "test"
    AWS_ENDPOINT_URL: str | None = None
    S3_BUCKET_NAME: str = "finsight-documents"
    S3_PRESIGNED_URL_EXPIRY: int = 3600

    # SQS (optional — tasks run in-process in free mode)
    USE_SQS: bool = False
    SQS_DOCUMENT_QUEUE_URL: str = "http://localhost:4566/000000000000/finsight-documents"

    # ── DynamoDB audit logging ────────────────────────────────────────────────
    USE_DYNAMODB: bool = False  # Set to True to enable DynamoDB audit logging
    DYNAMODB_AUDIT_TABLE: str = "finsight-query-audit"
    DYNAMODB_TTL_DAYS: int = 2555  # 7 years for SEC compliance (17a-4)

    # ── Compliance: Fernet encryption at rest (PDF §10) ───────────────────────
    # Generate a key once with:
    #   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    # Then paste it into .env. If left blank in dev, encryption is disabled
    # (raw bytes stored). In production a key MUST be set.
    FERNET_KEY: str = ""
    ENCRYPT_AT_REST: bool = True   # honoured only when FERNET_KEY is non-empty

    # ── Compliance: Presidio PII scanner (PDF §0, §10) ────────────────────────
    # When True (default), uses Microsoft Presidio + spaCy for 50+ entity types.
    # On import failure (model missing, etc.) the service falls back to the
    # built-in regex scanner so the upload pipeline never breaks.
    USE_PRESIDIO: bool = True
    PRESIDIO_LANGUAGE: str = "en"
    PRESIDIO_MIN_SCORE: float = 0.5  # entities below this confidence are dropped
    PRESIDIO_SPACY_MODEL: str = "en_core_web_sm"

    # ── Compliance: audit log retention (SEC Rule 17a-4) ──────────────────────
    AUDIT_LOG_RETENTION_YEARS: int = 7

    # ── AWS SES email (Phase 3 — alerts) ─────────────────────────────────────
    USE_SES: bool = False
    SES_FROM_ADDRESS: str = "alerts@finsight.local"
    APP_URL: str = "http://localhost:3000"  # public dashboard URL used in email links

    # ── Email backend (PR 3 — Mailhog dev SMTP / SES prod) ────────────────────
    # Resolution order, first hit wins:
    #   1. USE_SES=true              → AWS SES (production)
    #   2. SMTP_HOST is non-empty    → SMTP (Mailhog in dev, Gmail/SES in prod)
    #   3. neither                   → log-only (no email leaves the box)
    # Mailhog has zero auth and listens on port 1025 in the docker-compose
    # service of the same name. Web UI on http://localhost:8025.
    SMTP_HOST: str = ""
    SMTP_PORT: int = 1025
    SMTP_USERNAME: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_USE_TLS: bool = False     # leave False for Mailhog; True for Gmail/Office365
    EMAIL_FROM_ADDRESS: str = ""    # falls back to SES_FROM_ADDRESS if blank

    # ── Object storage backend toggle (PR 3 — SeaweedFS dev / S3 prod) ───────
    # SeaweedFS speaks the S3 API, so it reuses the existing _S3Storage class.
    # When ``USE_SEAWEEDFS=true`` (compose default) AWS_ENDPOINT_URL is
    # overridden to point at the seaweedfs container and USE_S3 is forced
    # true regardless of its declared value. To use real AWS S3 in prod, set
    # USE_SEAWEEDFS=false + USE_S3=true and leave AWS_ENDPOINT_URL blank.
    USE_SEAWEEDFS: bool = False
    SEAWEEDFS_S3_ENDPOINT: str = "http://seaweedfs:8333"

    # ── Observability (PR 3 — Prometheus + Grafana) ───────────────────────────
    # When True, /metrics is exposed and Prometheus scrapes the FastAPI
    # process. Grafana provisions a dashboard pointing at the Prometheus
    # service (see infra/grafana/provisioning).
    ENABLE_PROMETHEUS: bool = True
    PROMETHEUS_METRICS_PATH: str = "/metrics"

    # ── SEC EDGAR poller (Phase 3 — proactive filings) ───────────────────────
    USE_EDGAR_POLLER: bool = False
    EDGAR_POLL_INTERVAL_SECONDS: int = 3600  # 1 hour
    EDGAR_USER_AGENT: str = "FinSight-AI/0.1 (contact@finsight.local)"  # SEC requires this

    # ── Re-ranker (cross-encoder, local CPU) ──────────────────────
    RERANKER_MODEL: str = "cross-encoder/ms-marco-MiniLM-L-6-v2"
    RERANKER_TOP_N: int = 5
    RETRIEVER_TOP_K: int = 20
    RRF_K: int = 60

    # ── Document processing ───────────────────────────────────────
    MAX_UPLOAD_SIZE_MB: int = 50
    CHUNK_SIZE_CHARS: int = 800
    CHUNK_OVERLAP_CHARS: int = 150
    ALLOWED_MIME_TYPES: list[str] = [
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "text/plain",
    ]

    @field_validator("LOG_LEVEL")
    @classmethod
    def validate_log_level(cls, v: str) -> str:
        allowed = {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}
        if v.upper() not in allowed:
            raise ValueError(f"LOG_LEVEL must be one of {allowed}")
        return v.upper()

    # ── PR 3 helpers: SeaweedFS-aware S3 settings ─────────────────────────────
    @property
    def effective_use_s3(self) -> bool:
        """True when the storage layer should use the S3 backend.

        SeaweedFS speaks S3, so enabling it implicitly enables the S3
        backend regardless of the ``USE_S3`` flag.
        """
        return self.USE_S3 or self.USE_SEAWEEDFS

    @property
    def effective_s3_endpoint_url(self) -> str | None:
        """Endpoint URL boto3 should hit. SeaweedFS wins over manual override."""
        if self.USE_SEAWEEDFS:
            return self.SEAWEEDFS_S3_ENDPOINT
        return self.AWS_ENDPOINT_URL


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings: Settings = get_settings()
