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
    PENDING     = "pending"
    UPLOADING   = "uploading"
    UPLOADED    = "uploaded"
    EXTRACTING  = "extracting"
    EXTRACTED   = "extracted"
    CHUNKING    = "chunking"
    CHUNKED     = "chunked"
    EMBEDDING   = "embedding"
    INDEXED     = "indexed"
    FAILED      = "failed"


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

    original_filename: Mapped[str] = mapped_column(String(512), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(128), nullable=False)
    file_size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    page_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    doc_type: Mapped[str] = mapped_column(
        Enum(DocumentType, name="document_type_enum", values_callable=lambda x: [e.value for e in x]),
        default=DocumentType.OTHER,
        nullable=False,
    )
    company_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    ticker: Mapped[Optional[str]] = mapped_column(String(20), nullable=True, index=True)
    fiscal_period: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)

    s3_key_original: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)
    s3_key_extracted: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)

    status: Mapped[str] = mapped_column(
        Enum(DocumentStatus, name="document_status_enum", values_callable=lambda x: [e.value for e in x]),
        default=DocumentStatus.PENDING,
        nullable=False,
        index=True,
    )
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    pii_scan_passed: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    pii_entities_found: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    avg_confidence: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now, nullable=False
    )

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

    text: Mapped[str] = mapped_column(Text, nullable=False)
    chunk_type: Mapped[str] = mapped_column(
        Enum(ChunkType, name="chunk_type_enum", values_callable=lambda x: [e.value for e in x]),
        default=ChunkType.PROSE,
        nullable=False,
    )

    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    page_number: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    char_start: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    char_end: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    table_header: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    source_section: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)

    pinecone_id: Mapped[Optional[str]] = mapped_column(String(256), nullable=True, index=True)
    embedding_model: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, nullable=False
    )

    document: Mapped["Document"] = relationship("Document", back_populates="chunks")

    def __repr__(self) -> str:
        return (
            f"<Chunk id={self.id!r} doc={self.document_id!r} "
            f"idx={self.chunk_index} type={self.chunk_type!r}>"
        )


# ── query_logs (immutable audit trail) ───────────────────────────────────────
class QueryLog(Base):
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

    source_chunk_ids: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    source_doc_ids: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    latency_ms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    model_used: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, nullable=False, index=True
    )

    def __repr__(self) -> str:
        return f"<QueryLog id={self.id!r} user={self.user_id!r}>"


# ── analytics_summary ─────────────────────────────────────────────────────────
class AnalyticsSummary(Base):
    __tablename__ = "analytics_summary"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    query_log_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("query_logs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )

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
    __tablename__ = "document_comparisons"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )

    document_a_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False
    )
    document_b_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False
    )

    financial_metrics_comparison: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    sentiment_comparison: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    narrative_summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    total_metrics_compared: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    metrics_with_significant_changes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    overall_sentiment_shift: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)

    status: Mapped[str] = mapped_column(String(50), nullable=False, default="processing")
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
    __tablename__ = "sentiment_analysis"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    document_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True
    )

    positive_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    neutral_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    negative_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    dominant_sentiment: Mapped[str] = mapped_column(String(20), nullable=False)
    confidence_level: Mapped[str] = mapped_column(String(20), nullable=False)
    sections_analyzed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    section_sentiments: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    model_used: Mapped[str] = mapped_column(String(100), nullable=False, default="ProsusAI/finbert")

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, nullable=False, index=True
    )

    def __repr__(self) -> str:
        return f"<SentimentAnalysis id={self.id!r} doc={self.document_id!r} sentiment={self.dominant_sentiment}>"


# ── metric_history ────────────────────────────────────────────────────────────
class MetricHistory(Base):
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

    __table_args__ = (
        UniqueConstraint("document_id", "metric_name", name="uq_metric_history_doc_metric"),
    )

    def __repr__(self) -> str:
        return f"<MetricHistory ticker={self.ticker} {self.metric_name}={self.metric_value}>"


# ── alerts ────────────────────────────────────────────────────────────────────
class Alert(Base):
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
    severity: Mapped[str] = mapped_column(String(16), nullable=False, index=True)

    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)

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


# ── ticker_subscriptions ──────────────────────────────────────────────────────
class TickerSubscription(Base):
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

    subscribe_anomaly: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    subscribe_sentiment: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    subscribe_filing: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    subscribe_regulatory: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    email_notifications: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)

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


# ── audit_logs ────────────────────────────────────────────────────────────────
class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)

    workspace_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("workspaces.id", ondelete="SET NULL"), nullable=True, index=True,
    )
    user_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True,
    )

    action: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    resource_type: Mapped[str] = mapped_column(String(50), nullable=False)
    resource_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)

    ip_address: Mapped[Optional[str]] = mapped_column(String(45), nullable=True)
    user_agent: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    request_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    status_code: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    audit_metadata: Mapped[Optional[dict]] = mapped_column(
        "metadata", JSON, nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, nullable=False, index=True
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )

    def __repr__(self) -> str:
        return (
            f"<AuditLog id={self.id!r} action={self.action!r} "
            f"resource={self.resource_type}/{self.resource_id!r}>"
        )


# ── chunk_embeddings ──────────────────────────────────────────────────────────
class ChunkEmbedding(Base):
    __tablename__ = "chunk_embeddings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    chunk_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("chunks.id", ondelete="CASCADE"),
        nullable=False, unique=True, index=True,
    )
    document_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("documents.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    point_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    embedding: Mapped[str] = mapped_column(Text, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, nullable=False
    )

    chunk: Mapped["Chunk"] = relationship("Chunk", foreign_keys=[chunk_id])

    def __repr__(self) -> str:
        return f"<ChunkEmbedding chunk={self.chunk_id!r} doc={self.document_id!r}>"