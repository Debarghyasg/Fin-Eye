"""
Pydantic Settings — all configuration loaded from environment variables / .env file.
100% free stack — no paid services, no Docker required.

Free service map (all run natively on Windows 11)
-------------------------------------------------
  LLM          : Groq  (Llama 3.1 70B — 14,400 req/day free)
  Embeddings   : HuggingFace sentence-transformers/all-MiniLM-L6-v2  (local, CPU)
  Vector store : Qdrant  (single .exe, listens on 6333)
  BM25         : Qdrant native sparse vectors  (no separate service)
  File storage : Local filesystem  (./uploads folder)
  Queue        : Celery ALWAYS_EAGER=true  (inline, no broker needed)
  PII scan     : Microsoft Presidio + spaCy  (local, no cloud)
  Auth         : Clerk  (free tier)
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
    # Local PostgreSQL 16 — install from https://www.postgresql.org/download/windows/
    DATABASE_URL: str = Field(
        default="postgresql+asyncpg://finsight:finsight_dev@localhost:5432/finsight",
    )

    @property
    def sync_database_url(self) -> str:
        """Synchronous URL used by Alembic CLI."""
        return self.DATABASE_URL.replace(
            "postgresql+asyncpg://", "postgresql+psycopg2://"
        )

    DB_POOL_SIZE: int = 10
    DB_MAX_OVERFLOW: int = 20
    DB_POOL_TIMEOUT: int = 30

    # Used by alembic env.py only — not read at runtime
    POSTGRES_USER: str = "finsight"
    POSTGRES_PASSWORD: str = "finsight_dev"
    POSTGRES_DB: str = "finsight"

    # ── Clerk Auth ────────────────────────────────────────────────
    # Get keys from https://dashboard.clerk.com → your app → API Keys
    CLERK_SECRET_KEY: str = ""
    CLERK_PUBLISHABLE_KEY: str = ""
    CLERK_JWKS_URL: str = "https://api.clerk.dev/v1/jwks"
    CLERK_JWT_AUDIENCE: str = ""

    # ── Groq LLM (free) ──────────────────────────────────────────
    # Free key at https://console.groq.com — 14,400 req/day, 6,000 tok/min
    GROQ_API_KEY: str = Field(default="", description="gsk_... from console.groq.com")
    GROQ_MODEL: str = "llama-3.1-70b-versatile"
    GROQ_FALLBACK_MODEL: str = "llama-3.1-8b-instant"

    # ── OpenAI (optional — only for document comparison) ─────────
    # Leave blank to use Groq as fallback for all features.
    OPENAI_API_KEY: str = Field(default="", description="Optional — GPT-4o for comparisons")
    OPENAI_MODEL: str = "gpt-4o"
    OPENAI_FALLBACK_MODEL: str = "gpt-4o-mini"

    # ── Local embeddings (free, CPU only) ─────────────────────────
    # Downloads ~90 MB on first run, cached in .cache/ automatically
    EMBEDDING_MODEL: str = "sentence-transformers/all-MiniLM-L6-v2"
    EMBEDDING_DIMENSION: int = 384

    # ── Qdrant vector store ───────────────────────────────────────
    # Download qdrant.exe from https://github.com/qdrant/qdrant/releases
    # Run it with ./qdrant.exe — no config needed, listens on 6333
    # Production swap: point QDRANT_URL at a Qdrant Cloud URL + set QDRANT_API_KEY
    QDRANT_URL: str = "http://localhost:6333"
    QDRANT_API_KEY: str = ""
    QDRANT_COLLECTION: str = "finsight_chunks"
    QDRANT_DENSE_VECTOR_NAME: str = "dense"
    QDRANT_SPARSE_VECTOR_NAME: str = "sparse"
    QDRANT_SPARSE_MODEL: str = "Qdrant/bm25"

    # Legacy ChromaDB settings — kept so old .env files don't error out
    CHROMA_HOST: str = "localhost"
    CHROMA_PORT: int = 8001
    CHROMA_COLLECTION: str = "finsight_chunks"

    # ── Redis (cache only) ────────────────────────────────────────
    # Install from https://github.com/microsoftarchive/redis/releases
    # Used for response caching only — NOT as a Celery broker
    REDIS_URL: str = "redis://localhost:6379/0"
    REDIS_BM25_TTL: int = 604800  # deprecated — kept so old .env files load

    # ── Celery task queue ─────────────────────────────────────────
    # CELERY_TASK_ALWAYS_EAGER=true  → recommended for local dev on Windows
    #   Tasks run inline in the same process — no RabbitMQ needed at all.
    #   Upload blocks until the document is fully indexed (~5-30s per PDF).
    #
    # CELERY_TASK_ALWAYS_EAGER=false → production / advanced local dev
    #   Requires RabbitMQ running on localhost:5672.
    #   Download from https://www.rabbitmq.com/install-windows.html
    CELERY_BROKER_URL: str = "amqp://guest:guest@localhost:5672//"
    CELERY_RESULT_BACKEND: str = "rpc://"
    CELERY_TASK_DEFAULT_QUEUE: str = "finsight"
    CELERY_TASK_ALWAYS_EAGER: bool = True   # safe default for local dev
    EDGAR_POLLER_BEAT_NAME: str = "edgar-poll-every-hour"

    # ── Local file storage ────────────────────────────────────────
    # Uploaded PDFs and extracted JSON saved here on your hard drive.
    # The folder is created automatically if it does not exist.
    USE_S3: bool = False
    LOCAL_STORAGE_PATH: str = "./uploads"

    # ── AWS (disabled by default) ─────────────────────────────────
    # Only needed if you set USE_S3=true or USE_SQS=true
    AWS_REGION: str = "us-east-1"
    AWS_ACCESS_KEY_ID: str = "test"
    AWS_SECRET_ACCESS_KEY: str = "test"
    AWS_ENDPOINT_URL: str | None = None
    S3_BUCKET_NAME: str = "finsight-documents"
    S3_PRESIGNED_URL_EXPIRY: int = 3600

    USE_SQS: bool = False
    SQS_DOCUMENT_QUEUE_URL: str = ""

    # ── DynamoDB audit logging (disabled by default) ──────────────
    USE_DYNAMODB: bool = False
    DYNAMODB_AUDIT_TABLE: str = "finsight-query-audit"
    DYNAMODB_TTL_DAYS: int = 2555  # 7 years for SEC 17a-4 compliance

    # ── Fernet encryption at rest ─────────────────────────────────
    # Optional in local dev. Generate a key with:
    #   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    # Leave blank to disable. Production MUST set a key.
    FERNET_KEY: str = ""
    ENCRYPT_AT_REST: bool = False   # only active when FERNET_KEY is set

    # ── Presidio PII scanner ──────────────────────────────────────
    # Needs spaCy model: python -m spacy download en_core_web_sm
    # Falls back to regex scanner if Presidio fails to import.
    USE_PRESIDIO: bool = True
    PRESIDIO_LANGUAGE: str = "en"
    PRESIDIO_MIN_SCORE: float = 0.5
    PRESIDIO_SPACY_MODEL: str = "en_core_web_sm"

    # ── Audit log retention (SEC Rule 17a-4) ──────────────────────
    AUDIT_LOG_RETENTION_YEARS: int = 7

    # ── Email ─────────────────────────────────────────────────────
    # Leave SMTP_HOST blank → emails are logged to console only (safe default).
    # To see emails: download MailHog (https://github.com/mailhog/MailHog/releases)
    #   run MailHog_windows_amd64.exe, then set SMTP_HOST=localhost SMTP_PORT=1025
    #   view captured emails at http://localhost:8025
    USE_SES: bool = False
    SES_FROM_ADDRESS: str = "alerts@finsight.local"
    APP_URL: str = "http://localhost:3000"
    SMTP_HOST: str = ""
    SMTP_PORT: int = 1025
    SMTP_USERNAME: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_USE_TLS: bool = False
    EMAIL_FROM_ADDRESS: str = ""

    # ── SeaweedFS (disabled — use local storage instead) ──────────
    USE_SEAWEEDFS: bool = False
    SEAWEEDFS_S3_ENDPOINT: str = ""

    # ── Prometheus metrics (optional) ─────────────────────────────
    # Set to false to save memory in local dev.
    ENABLE_PROMETHEUS: bool = False
    PROMETHEUS_METRICS_PATH: str = "/metrics"

    # ── SEC EDGAR poller ──────────────────────────────────────────
    USE_EDGAR_POLLER: bool = False
    EDGAR_POLL_INTERVAL_SECONDS: int = 3600
    EDGAR_USER_AGENT: str = "FinSight-AI/0.1 (contact@finsight.local)"

    # ── Re-ranker ─────────────────────────────────────────────────
    # ~85 MB download on first use, cached automatically
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

    # ── Storage helpers ────────────────────────────────────────────
    @property
    def effective_use_s3(self) -> bool:
        """True when the storage layer should use the S3 backend."""
        return self.USE_S3 or self.USE_SEAWEEDFS

    @property
    def effective_s3_endpoint_url(self) -> str | None:
        """Endpoint URL boto3 should use."""
        if self.USE_SEAWEEDFS:
            return self.SEAWEEDFS_S3_ENDPOINT
        return self.AWS_ENDPOINT_URL


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings: Settings = get_settings()
