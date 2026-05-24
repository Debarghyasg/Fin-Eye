"""
Pydantic Settings — all configuration loaded from environment variables / .env file.
Every downstream module imports `settings` from here. No raw os.getenv() calls elsewhere.
"""
from functools import lru_cache
from typing import Literal

from pydantic import AnyHttpUrl, Field, field_validator
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
    # Comma-separated origins allowed by CORS
    ALLOWED_ORIGINS: str = "http://localhost:3000,http://127.0.0.1:3000"

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.ALLOWED_ORIGINS.split(",") if o.strip()]

    # ── Database ──────────────────────────────────────────────────
    DATABASE_URL: str = Field(
        default="postgresql+asyncpg://finsight:finsight_dev@localhost:5432/finsight",
        description="Async SQLAlchemy connection string (asyncpg driver).",
    )
    # Sync URL used ONLY by Alembic CLI (psycopg2)
    @property
    def sync_database_url(self) -> str:
        return self.DATABASE_URL.replace(
            "postgresql+asyncpg://", "postgresql+psycopg2://"
        )

    DB_POOL_SIZE: int = 10
    DB_MAX_OVERFLOW: int = 20
    DB_POOL_TIMEOUT: int = 30

    # ── Clerk Auth ────────────────────────────────────────────────
    CLERK_SECRET_KEY: str = Field(default="", description="sk_test_… from Clerk dashboard")
    CLERK_PUBLISHABLE_KEY: str = Field(default="", description="pk_test_… from Clerk dashboard")
    # Clerk JWKS endpoint — used to verify JWT signatures
    CLERK_JWKS_URL: str = "https://api.clerk.dev/v1/jwks"
    # Expected audience in the JWT (your Clerk frontend API URL)
    CLERK_JWT_AUDIENCE: str = Field(default="", description="e.g. https://your-app.clerk.accounts.dev")

    # ── AWS ───────────────────────────────────────────────────────
    AWS_REGION: str = "us-east-1"
    AWS_ACCESS_KEY_ID: str = Field(default="test", description="Use 'test' for LocalStack")
    AWS_SECRET_ACCESS_KEY: str = Field(default="test", description="Use 'test' for LocalStack")
    # Set to http://localhost:4566 for LocalStack, leave empty for real AWS
    AWS_ENDPOINT_URL: str | None = None

    # S3
    S3_BUCKET_NAME: str = "finsight-documents"
    S3_PRESIGNED_URL_EXPIRY: int = 3600  # seconds

    # SQS
    SQS_DOCUMENT_QUEUE_URL: str = Field(
        default="http://localhost:4566/000000000000/finsight-documents",
        description="SQS queue URL for async document processing events",
    )

    # ── OpenAI ────────────────────────────────────────────────────
    OPENAI_API_KEY: str = Field(default="", description="sk-… from OpenAI dashboard")
    OPENAI_EMBEDDING_MODEL: str = "text-embedding-3-large"
    OPENAI_CHAT_MODEL: str = "gpt-4o"

    # ── Pinecone (Week 3+) ────────────────────────────────────────
    PINECONE_API_KEY: str = ""
    PINECONE_ENVIRONMENT: str = "gcp-starter"
    PINECONE_INDEX_NAME: str = "finsight-docs"

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


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Cached settings singleton — import this everywhere."""
    return Settings()


# Module-level convenience alias
settings: Settings = get_settings()
