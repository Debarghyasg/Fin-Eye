"""
SQLAlchemy ORM models.

Tables
------
  users             — one row per Clerk identity
  workspaces        — a user's isolated document collection
  documents         — a single uploaded file (PDF / DOCX / TXT)
  chunks            — extracted text segments from a document
  chunk_embeddings  — pgvector dense embeddings (one row per chunk)
  query_logs        — immutable audit log of every RAG query (SEC Rule 17a-4)
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import Enum as PyEnum
from typing import List, Optional

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


# ── Helpers ───────────────────────────────────────────────────────────────────
def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ── Enums ─────────────────────────────────────────────────────────────────────
class DocumentStatus(str, PyEnum):
    PENDING     = "pending"      # record created, upload not yet confirmed
    UPLOADING   = "uploading"    # S3 upload in progress
    UPLOADED    = "uploaded"     # S3 upload confirmed
    EXTRACTING  = "extracting"   # PyMuPDF / pdfplumber running
    EXTRACTED   = "extracted"    # raw text + tables saved to S3
    CHUNKING    = "chunking"     # chunker running
    CHUNKED     = "chunked"      # chunks written to DB
    EMBEDDING   = "embedding"    # embedder running (Week 3)
    INDEXED     = "indexed"      # vectors in Pinecone (Week 3)
    FAILED      = "failed"       # any stage failed


class ChunkType(str, PyEnum):
    PROSE  = "prose"
    TABLE  = "table"
    HEADER = "header"


class DocumentType(str, PyEnum):
    TEN_K        = "10-K"
    TEN_Q        = "10-Q"
    EARNINGS     = "earnings_call"
    ANNUAL       = "annual_report"
    PROSPECTUS   = "prospectus"
    OTHER        = "other"


# ── users ─────────────────────────────────────────────────────────────────────
class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=_uuid
    )
    # Clerk's opaque user identifier (user_2abc…)
    clerk_user_id: Mapped[str] = mapped_column(
        String(255), unique=True, nullable=False, index=True
    )
    email: Mapped[str] = mapped_column(String(320), nullable=False, default="")
    full_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now, nullable=False
    )

    # relationships
    workspaces: Mapped[List["Workspace"]] = relationship(
        "Workspace", back_populates="owner", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<User id={self.id!r} email={self.email!r}>"


# ── workspaces ────────────────────────────────────────────────────────────────
class Workspace(Base):
    __tablename__ = "workspaces"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    owner_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now, nullable=False
    )

    # relationships
    owner: Mapped["User"] = relationship("User", back_populates="workspaces")
    documents: Mapped[List["Document"]] = relationship(
        "Document", back_populates="workspace", cascade="all, delete-orphan"
    )

    __table_args__ = (
        UniqueConstraint("owner_id", "name", name="uq_workspace_owner_name"),
    )

    def __repr__(self) -> str:
        return f"<Workspace id={self.id!r} name={self.name!r}>"


# ── documents ─────────────────────────────────────────────────────────────────
class Document(Base):
    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    uploaded_by_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # File metadata
    original_filename: Mapped[str] = mapped_column(String(512), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(128), nullable=False)
    file_size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    page_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # Financial metadata (can be set by user or auto-detected)
    doc_type: Mapped[str] = mapped_column(
        Enum(DocumentType, name="document_type_enum"),
        default=DocumentType.OTHER,
        nullable=False,
    )
    company_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    ticker: Mapped[Optional[str]] = mapped_column(String(20), nullable=True, index=True)
    fiscal_period: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)  # e.g. "FY2023"

    # Storage locations in S3
    s3_key_original: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)
    s3_key_extracted: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)

    # Processing pipeline state
    status: Mapped[str] = mapped_column(
        Enum(DocumentStatus, name="document_status_enum"),
        default=DocumentStatus.PENDING,
        nullable=False,
        index=True,
    )
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # PII scan result (AWS Comprehend)
    pii_scan_passed: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    pii_entities_found: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON list

    # RAG quality metrics (populated after indexing)
    avg_confidence: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now, nullable=False
    )

    # relationships
    workspace: Mapped["Workspace"] = relationship("Workspace", back_populates="documents")
    uploaded_by: Mapped[Optional["User"]] = relationship("User", foreign_keys=[uploaded_by_id])
    chunks: Mapped[List["Chunk"]] = relationship(
        "Chunk", back_populates="document", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<Document id={self.id!r} file={self.original_filename!r} status={self.status!r}>"


# ── chunks ────────────────────────────────────────────────────────────────────
class Chunk(Base):
    __tablename__ = "chunks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    document_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # Content
    text: Mapped[str] = mapped_column(Text, nullable=False)
    chunk_type: Mapped[str] = mapped_column(
        Enum(ChunkType, name="chunk_type_enum"),
        default=ChunkType.PROSE,
        nullable=False,
    )

    # Positional metadata
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)   # 0-based ordering within doc
    page_number: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # 1-based PDF page
    char_start: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)   # offset in extracted text
    char_end: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # Table-specific metadata (JSON stored as text for now; use JSONB in prod)
    table_header: Mapped[Optional[str]] = mapped_column(Text, nullable=True)    # serialised row headers
    source_section: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)  # e.g. "Risk Factors"

    # Embedding (Week 3 — pinecone_id links this chunk to a Pinecone vector)
    pinecone_id: Mapped[Optional[str]] = mapped_column(String(256), nullable=True, index=True)
    embedding_model: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, nullable=False
    )

    # relationships
    document: Mapped["Document"] = relationship("Document", back_populates="chunks")

    def __repr__(self) -> str:
        return (
            f"<Chunk id={self.id!r} doc={self.document_id!r} "
            f"idx={self.chunk_index} type={self.chunk_type!r}>"
        )


# ── query_logs (immutable audit trail) ───────────────────────────────────────
class QueryLog(Base):
    """
    Append-only audit log of every RAG query.
    Satisfies SEC Rule 17a-4 record retention requirements.
    Never update or delete rows from this table.
    """
    __tablename__ = "query_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspaces.id", ondelete="SET NULL"), nullable=True
    )

    query_text: Mapped[str] = mapped_column(Text, nullable=False)
    answer_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    confidence_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # JSON arrays serialised as text
    source_chunk_ids: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    source_doc_ids: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    latency_ms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    model_used: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, nullable=False, index=True
    )

    def __repr__(self) -> str:
        return f"<QueryLog id={self.id!r} user={self.user_id!r}>"


# ── analytics_summary (aggregated metrics for fast queries) ─────────────────────
class AnalyticsSummary(Base):
    """
    Aggregated query metrics for analytics dashboard.
    
    Supplements the detailed query_logs with pre-calculated metrics
    for faster analytics queries without scanning the full audit table.
    """
    __tablename__ = "analytics_summary"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    query_log_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("query_logs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    
    # Pre-calculated metrics
    source_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    citation_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    unique_documents: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    avg_source_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, nullable=False, index=True
    )

    def __repr__(self) -> str:
        return f"<AnalyticsSummary id={self.id!r} query_log={self.query_log_id!r}>"


# ── document_comparisons ──────────────────────────────────────────────────────
class DocumentComparison(Base):
    """
    Stores results of financial document comparisons for future reference.
    
    Each comparison analyzes two documents and extracts financial metrics,
    sentiment analysis, and percentage changes between reporting periods.
    """
    __tablename__ = "document_comparisons"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    
    # Documents being compared
    document_a_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False
    )
    document_b_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False
    )
    
    # Comparison results (stored as JSON)
    financial_metrics_comparison: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON
    sentiment_comparison: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON
    narrative_summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    # Summary statistics
    total_metrics_compared: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    metrics_with_significant_changes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    overall_sentiment_shift: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)  # positive/negative/stable
    
    # Processing metadata
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="processing")  # processing/completed/failed
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    processing_time_ms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, nullable=False, index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now, nullable=False
    )

    def __repr__(self) -> str:
        return f"<DocumentComparison id={self.id!r} docs={self.document_a_id!r}vs{self.document_b_id!r}>"


# ── sentiment_analysis ────────────────────────────────────────────────────────
class SentimentAnalysis(Base):
    """
    Stores FinBERT sentiment analysis results for financial documents.
    
    Tracks sentiment over time for management commentary, earnings calls,
    and other forward-looking statements in financial documents.
    """
    __tablename__ = "sentiment_analysis"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    document_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    
    # Sentiment scores (0.0 to 1.0)
    positive_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    neutral_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    negative_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    
    # Analysis metadata
    dominant_sentiment: Mapped[str] = mapped_column(String(20), nullable=False)  # positive/neutral/negative
    confidence_level: Mapped[str] = mapped_column(String(20), nullable=False)  # high/medium/low
    sections_analyzed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    
    # Detailed results (stored as JSON)
    section_sentiments: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON array
    
    # Model information
    model_used: Mapped[str] = mapped_column(String(100), nullable=False, default="ProsusAI/finbert")
    
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, nullable=False, index=True
    )

    def __repr__(self) -> str:
        return f"<SentimentAnalysis id={self.id!r} doc={self.document_id!r} sentiment={self.dominant_sentiment}>"



# ── metric_history (per-ticker historical metric values for anomaly detection)
class MetricHistory(Base):
    """
    Per-ticker time series of extracted financial metric values.

    Populated whenever a document for a ticker is processed. Anomaly detection
    pulls historical rows for the same (workspace_id, ticker, metric_name) tuple
    to compute mean/stdev/Z-score and decide whether to flag the new value.
    """
    __tablename__ = "metric_history"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    document_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    ticker: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    metric_name: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    metric_value: Mapped[float] = mapped_column(Float, nullable=False)
    fiscal_period: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, nullable=False, index=True
    )

    # One row per (document, metric) — re-running detection should upsert, not duplicate
    __table_args__ = (
        UniqueConstraint("document_id", "metric_name", name="uq_metric_history_doc_metric"),
    )

    def __repr__(self) -> str:
        return f"<MetricHistory ticker={self.ticker} {self.metric_name}={self.metric_value}>"


# ── alerts (anomaly + sentiment + filing notifications) ───────────────────────
class Alert(Base):
    """
    User-facing alert generated by the anomaly detection or other monitors.
    SEC 17a-4-style: never updated except `read` and `email_sent` flags.
    """
    __tablename__ = "alerts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    document_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("documents.id", ondelete="SET NULL"), nullable=True, index=True
    )
    ticker: Mapped[Optional[str]] = mapped_column(String(20), nullable=True, index=True)

    alert_type: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    # one of: "anomaly" | "sentiment" | "regulatory" | "filing"
    severity: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    # one of: "high" | "medium" | "low" | "info"

    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)

    # Statistical fields (populated for anomaly alerts)
    metric_name: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    metric_value: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    z_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    historical_mean: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    historical_stdev: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    sample_size: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    email_sent: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, nullable=False, index=True
    )

    def __repr__(self) -> str:
        return f"<Alert {self.alert_type}/{self.severity} ticker={self.ticker!r} title={self.title!r}>"


# ── ticker_subscriptions (user opt-in for monitoring) ─────────────────────────
class TickerSubscription(Base):
    """
    A user's subscription to a ticker. Drives anomaly notification routing
    and the SEC EDGAR background poller.
    """
    __tablename__ = "ticker_subscriptions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    ticker: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    company_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # Per-channel toggles
    subscribe_anomaly: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    subscribe_sentiment: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    subscribe_filing: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    subscribe_regulatory: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    email_notifications: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)

    # SEC EDGAR poller state
    last_edgar_check_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_edgar_filing_url: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)
    last_edgar_accession: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now, nullable=False
    )

    __table_args__ = (
        UniqueConstraint("user_id", "ticker", name="uq_ticker_sub_user_ticker"),
    )

    def __repr__(self) -> str:
        return f"<TickerSubscription user={self.user_id!r} ticker={self.ticker!r} active={self.active}>"



# ── audit_logs (SEC Rule 17a-4 append-only audit trail) ──────────────────────
class AuditLog(Base):
    """Append-only audit trail of every meaningful user action.

    Distinct from :class:`QueryLog` (which captures RAG-specific Q/A pairs):
    this table records *all* actions — UPLOAD, DOWNLOAD, DELETE, EXPORT,
    LOGIN, COMPARE, ALERT_VIEW, etc. — across the platform.

    Schema mirrors the production DynamoDB layout so the production migration
    is a model swap, not a redesign:

        partition key  → workspace_id
        sort key       → created_at
        GSI            → user_id

    Records must never be UPDATEd or DELETEd. The ``expires_at`` column is a
    *soft* TTL: a downstream cleanup job (Phase 5) will physically purge rows
    past the SEC 17a-4 retention horizon. Until then this is an append-only
    log even at the DB level (the migration revokes UPDATE/DELETE on the
    application role).
    """
    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)

    # Tenancy / actor
    workspace_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("workspaces.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    user_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # What happened
    action: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    # Free-form but standard values: QUERY | UPLOAD | DOWNLOAD | DELETE |
    # EXPORT | COMPARE | LOGIN | UPDATE | VIEW | ALERT_VIEW | ALERT_ACK
    resource_type: Mapped[str] = mapped_column(String(50), nullable=False)
    # document | query | workspace | comparison | alert | subscription | user
    resource_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)

    # Request context
    ip_address: Mapped[Optional[str]] = mapped_column(String(45), nullable=True)
    user_agent: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    request_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    status_code: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # Free-form JSON for action-specific detail (filename, query_text, etc.).
    # Maps to JSONB on PostgreSQL, JSON on SQLite (test).
    audit_metadata: Mapped[Optional[dict]] = mapped_column(
        "metadata", JSON, nullable=True,
    )

    # Time
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, nullable=False, index=True
    )
    # Soft TTL — a Phase-5 cleanup job will purge rows past this timestamp.
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )

    def __repr__(self) -> str:
        return (
            f"<AuditLog id={self.id!r} action={self.action!r} "
            f"resource={self.resource_type}/{self.resource_id!r}>"
        )



# ── chunk_embeddings (dense embeddings — plain Postgres, no pgvector) ─────────
class ChunkEmbedding(Base):
    """
    One dense embedding vector per chunk.

    Replaces the external Qdrant vector store.  The embedding is stored as a
    JSON-encoded list[float] in a plain ``TEXT`` column, so this works on a
    vanilla PostgreSQL install with **no extensions** (and on SQLite in tests).
    Similarity search computes cosine in Python at query time — see
    ``app/services/rag/pg_vector_store.py``.

    The ``point_id`` column carries the deterministic UUID5 derived from
    ``"{document_id}_{chunk_index}"``; the retriever joins on it to resolve
    a search hit back to its parent chunk + document.
    """
    __tablename__ = "chunk_embeddings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    chunk_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("chunks.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    document_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("documents.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    workspace_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # Deterministic UUID5 — the retriever's join key from a search hit.
    point_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)

    # JSON-encoded list[float] of length EMBEDDING_DIMENSION (384).
    # Plain TEXT keeps this dependency-free on every backend; all reads/writes
    # go through pg_vector_store.py which json-(de)serialises the vector.
    embedding: Mapped[str] = mapped_column(Text, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, nullable=False
    )

    # relationships
    chunk: Mapped["Chunk"] = relationship("Chunk", foreign_keys=[chunk_id])

    def __repr__(self) -> str:
        return f"<ChunkEmbedding chunk={self.chunk_id!r} doc={self.document_id!r}>"
