"""
Pydantic v2 request / response schemas.

Naming convention
-----------------
  <Model>Create  — body for POST (create) requests
  <Model>Update  — body for PATCH (partial update) requests
  <Model>Out     — response payload returned to the client
  <Model>List    — paginated list wrapper
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Generic, List, Optional, TypeVar

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.db.models import ChunkType, DocumentStatus, DocumentType

T = TypeVar("T")


# ── Shared base ───────────────────────────────────────────────────────────────
class _Base(BaseModel):
    model_config = ConfigDict(from_attributes=True)  # enables ORM mode


class PaginatedList(_Base, Generic[T]):
    items: List[T]
    total: int
    page: int
    page_size: int
    has_next: bool


# ── User ──────────────────────────────────────────────────────────────────────
class UserOut(_Base):
    id: str
    clerk_user_id: str
    email: str
    full_name: Optional[str] = None
    is_active: bool
    created_at: datetime


class UserUpdate(_Base):
    full_name: Optional[str] = Field(None, max_length=255)
    email: Optional[EmailStr] = None


# ── Workspace ─────────────────────────────────────────────────────────────────
class WorkspaceCreate(_Base):
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = Field(None, max_length=1024)


class WorkspaceUpdate(_Base):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None


class WorkspaceOut(_Base):
    id: str
    owner_id: str
    name: str
    description: Optional[str]
    is_default: bool
    document_count: int = 0       # populated in route handler
    created_at: datetime
    updated_at: datetime


# ── Document ──────────────────────────────────────────────────────────────────
class DocumentOut(_Base):
    id: str
    workspace_id: str
    original_filename: str
    mime_type: str
    file_size_bytes: int
    page_count: Optional[int]
    doc_type: DocumentType
    company_name: Optional[str]
    ticker: Optional[str]
    fiscal_period: Optional[str]
    status: DocumentStatus
    error_message: Optional[str]
    pii_scan_passed: Optional[bool]
    avg_confidence: Optional[float]
    created_at: datetime
    updated_at: datetime


class DocumentUpdate(_Base):
    """Fields the user can manually correct after upload."""
    doc_type: Optional[DocumentType] = None
    company_name: Optional[str] = Field(None, max_length=255)
    ticker: Optional[str] = Field(None, max_length=20)
    fiscal_period: Optional[str] = Field(None, max_length=20)


class DocumentUploadResponse(_Base):
    """Returned immediately after file is accepted — before processing finishes."""
    document_id: str
    status: DocumentStatus
    message: str = "Document accepted. Processing started asynchronously."


class DocumentStatusResponse(_Base):
    document_id: str
    status: DocumentStatus
    page_count: Optional[int]
    chunk_count: int = 0
    error_message: Optional[str]
    updated_at: datetime


# ── Chunk ─────────────────────────────────────────────────────────────────────
class ChunkOut(_Base):
    id: str
    document_id: str
    text: str
    chunk_type: ChunkType
    chunk_index: int
    page_number: Optional[int]
    source_section: Optional[str]
    table_header: Optional[str]
    created_at: datetime


# ── Query ─────────────────────────────────────────────────────────────────────
class QueryRequest(_Base):
    query: str = Field(..., min_length=3, max_length=2000)
    workspace_id: str
    # Optional: restrict search to specific docs
    document_ids: Optional[List[str]] = None
    top_k: int = Field(default=5, ge=1, le=20)


class CitationDetail(_Base):
    """Detailed citation information with document context."""
    chunk_id: str
    page_number: Optional[int]
    excerpt: str
    document_name: str


class SourceReference(_Base):
    document_id: str
    chunk_id: str
    page_number: Optional[int]
    excerpt: str
    score: float


class QueryResponse(_Base):
    query_log_id: str
    query: str
    answer: str
    confidence: float
    citations: List[CitationDetail]  # Enhanced with structured citations
    sources: List[SourceReference]
    latency_ms: int
    model_used: str


# ── Document Comparison (Phase 3 Week 5) ─────────────────────────────────────
class DocumentComparisonRequest(_Base):
    document_a_id: str = Field(..., description="First document ID (earlier period / baseline)")
    document_b_id: str = Field(..., description="Second document ID (later period / comparison)")
    include_sentiment: bool = Field(default=True, description="Run FinBERT sentiment analysis")
    include_narrative: bool = Field(default=True, description="Generate LLM narrative summary")


class FinancialMetricComparison(_Base):
    metric_name: str
    old_value: Optional[float] = None
    new_value: Optional[float] = None
    absolute_change: Optional[float] = None
    percentage_change: Optional[float] = None
    direction: str  # "increase" | "decrease" | "flat"
    significance: str  # "major" | "moderate" | "minor" | "negligible" | "unknown"


class DocumentComparisonResult(_Base):
    comparison_id: str
    status: str  # "processing" | "completed" | "failed"
    documents: Dict[str, Any]
    financial_metrics: List[FinancialMetricComparison] = []
    risk_factor_changes: Optional[Dict[str, Any]] = None
    guidance_change: Optional[Dict[str, Any]] = None
    sentiment_analysis: Optional[Dict[str, Any]] = None
    narrative_summary: Optional[str] = None
    summary_statistics: Dict[str, Any] = {}
    processing_time_ms: Optional[int] = None
    error_message: Optional[str] = None
    created_at: datetime


class DocumentComparisonListItem(_Base):
    id: str
    workspace_id: str
    document_a_id: str
    document_b_id: str
    status: str
    total_metrics_compared: int
    metrics_with_significant_changes: int
    overall_sentiment_shift: Optional[str]
    processing_time_ms: Optional[int]
    created_at: datetime


# ── Sentiment Analysis ───────────────────────────────────────────────────────
class SentimentAnalysisRequest(_Base):
    document_id: str


class SentimentAnalysisResult(_Base):
    analysis_id: str
    document_id: str
    overall_sentiment: Dict[str, float]  # {positive, neutral, negative}
    dominant_sentiment: str
    confidence: str  # "high" | "medium" | "low"
    sections_analyzed: int
    section_details: List[Dict[str, Any]] = []
    model_used: str
    created_at: datetime


# ── Analytics ─────────────────────────────────────────────────────────────────
class HealthResponse(_Base):
    status: str
    database: str
    version: str
    environment: str


class PipelineStageStatus(_Base):
    stage: str
    status: str          # "ok" | "degraded" | "down"
    latency_ms: Optional[int]
    detail: Optional[str]


class PipelineHealthResponse(_Base):
    overall: str
    stages: List[PipelineStageStatus]


class DocumentStats(_Base):
    total_documents: int
    indexed: int
    processing: int
    failed: int
    total_chunks: int
    total_queries: int


class ComparisonRequest(_Base):
    document_id_a: str
    document_id_b: str


class AnomalyAlert(_Base):
    document_id: str
    ticker: Optional[str]
    alert_type: str          # "anomaly" | "sentiment" | "regulatory" | "filing"
    severity: str            # "high" | "medium" | "low" | "info"
    title: str
    description: str
    created_at: datetime
