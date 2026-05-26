"""
SQLAlchemy ORM models.

Tables
------
  users          — one row per Clerk identity
  workspaces     — a user's isolated document collection
  documents      — a single uploaded file (PDF / DOCX / TXT)
  chunks         — extracted text segments from a document
  query_logs     — immutable audit log of every RAG query (SEC Rule 17a-4)
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
