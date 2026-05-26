"""
Integration tests for the full RAG query pipeline — Week 11.

Covers
------
  retrieve → rerank → generate → write QueryLog → write audit log → respond

The retrieval / reranking / generation services each call out to either
heavy local models (sentence-transformers, cross-encoder) or a remote
service (Groq). All three are stubbed here. We assert that:

  - The pipeline orchestrates the three stages in the right order
  - QueryLog is written to PostgreSQL with the answer + sources
  - QueryResponse carries the citations, sources, latency_ms, and model_used
  - The empty-candidates path still emits a QueryLog with confidence 0.0
  - The HTTP route POST /api/v1/queries works end-to-end against the same stubs
"""
from __future__ import annotations

from unittest.mock import patch

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.db.models import (
    Chunk,
    ChunkType,
    Document,
    DocumentStatus,
    DocumentType,
    QueryLog,
    Workspace,
)
from app.db.schemas import QueryRequest


# ── Fixtures ─────────────────────────────────────────────────────────────────
@pytest_asyncio.fixture
async def pipeline_workspace(db_session):
    """Workspace + 1 indexed document with 2 chunks, ready for query."""
    ws = Workspace(
        id="ws-pipeline",
        owner_id="test-user-id",
        name="Pipeline WS",
        is_default=True,
    )
    doc = Document(
        id="doc-pipe-1",
        workspace_id=ws.id,
        original_filename="Apple_10K_FY2023.pdf",
        mime_type="application/pdf",
        file_size_bytes=1_000_000,
        page_count=88,
        doc_type=DocumentType.TEN_K,
        company_name="Apple Inc.",
        ticker="AAPL",
        fiscal_period="FY2023",
        status=DocumentStatus.INDEXED,
    )
    chunks = [
        Chunk(
            id="chunk-pipe-1",
            document_id=doc.id,
            text="Total net sales were $383.3 billion for fiscal 2023.",
            chunk_type=ChunkType.PROSE,
            chunk_index=0,
            page_number=27,
            source_section="MD&A",
            pinecone_id="doc-pipe-1_0",
        ),
        Chunk(
            id="chunk-pipe-2",
            document_id=doc.id,
            text="Gross margin expanded to 44.1% in fiscal 2023.",
            chunk_type=ChunkType.PROSE,
            chunk_index=1,
            page_number=28,
            source_section="MD&A",
            pinecone_id="doc-pipe-1_1",
        ),
    ]
    db_session.add(ws)
    db_session.add(doc)
    db_session.add_all(chunks)
    await db_session.commit()
    return {"workspace": ws, "document": doc}


# Canonical reranked candidates — what the retriever + reranker would yield
_RERANKED = [
    {
        "chunk_id":     "chunk-pipe-1",
        "chroma_id":    "doc-pipe-1_0",
        "document_id":  "doc-pipe-1",
        "text":         "Total net sales were $383.3 billion for fiscal 2023.",
        "chunk_type":   "prose",
        "page_number":  27,
        "source_section": "MD&A",
        "rrf_score":    0.0312,
        "dense_score":  0.91,
        "sparse_score": 4.5,
        "rerank_score": 0.97,
    },
    {
        "chunk_id":     "chunk-pipe-2",
        "chroma_id":    "doc-pipe-1_1",
        "document_id":  "doc-pipe-1",
        "text":         "Gross margin expanded to 44.1% in fiscal 2023.",
        "chunk_type":   "prose",
        "page_number":  28,
        "source_section": "MD&A",
        "rrf_score":    0.0290,
        "dense_score":  0.85,
        "sparse_score": 3.8,
        "rerank_score": 0.91,
    },
]


# Canonical generator output
_GENERATION = {
    "answer": "Apple's revenue was $383.3B in FY2023 [1] with gross margin of 44.1% [2].",
    "citations": [
        {"chunk_id": "1", "page_number": 27, "excerpt": "Total net sales were $383.3 billion", "document_name": "Apple 10-K FY2023"},
        {"chunk_id": "2", "page_number": 28, "excerpt": "Gross margin expanded to 44.1%",       "document_name": "Apple 10-K FY2023"},
    ],
    "confidence": 0.94,
    "model_used": "llama-3.1-70b-versatile",
    "sources": [
        {
            "chunk_id":    "chunk-pipe-1",
            "document_id": "doc-pipe-1",
            "page_number": 27,
            "excerpt":     "Total net sales were $383.3 billion for fiscal 2023.",
            "score":       0.97,
        },
        {
            "chunk_id":    "chunk-pipe-2",
            "document_id": "doc-pipe-1",
            "page_number": 28,
            "excerpt":     "Gross margin expanded to 44.1% in fiscal 2023.",
            "score":       0.91,
        },
    ],
}


# ── Service-level integration test ────────────────────────────────────────────
@pytest.mark.asyncio
async def test_query_pipeline_happy_path(monkeypatch, db_session, pipeline_workspace):
    """retrieve → rerank → generate → audit log → response — all stubbed."""
    from app.services.rag import pipeline as pipeline_module

    # GROQ_API_KEY is required by the pipeline as a startup guard
    monkeypatch.setattr("app.core.config.settings.GROQ_API_KEY", "gsk_test_stub")

    async def fake_retrieve(req, db, top_k=None):
        # Return the same candidates the reranker would receive
        return [
            {**c, "rerank_score": None}
            for c in _RERANKED
        ]

    async def fake_rerank(query, candidates, top_n=None):
        return _RERANKED[: (top_n or len(_RERANKED))]

    async def fake_generate(query, reranked_chunks, model=None):
        return dict(_GENERATION)

    async def fake_audit(**kwargs):
        # Comprehensive audit logger should be called but is a no-op in tests
        return None

    request = QueryRequest(
        query="What was Apple's revenue in FY2023?",
        workspace_id=pipeline_workspace["workspace"].id,
        top_k=5,
    )

    with patch("app.services.rag.retriever.retrieve", fake_retrieve), \
         patch("app.services.rag.reranker.rerank", fake_rerank), \
         patch("app.services.rag.generator.generate_answer", fake_generate), \
         patch("app.services.audit.write_comprehensive_audit_log", fake_audit):

        response = await pipeline_module.run_query_pipeline(
            request=request,
            user_id="test-user-id",
            db=db_session,
        )

    # ── Response shape ────────────────────────────────────────────────────────
    assert response.query == request.query
    assert "$383.3B" in response.answer
    assert response.confidence == pytest.approx(0.94)
    assert response.model_used == "llama-3.1-70b-versatile"
    assert response.latency_ms >= 0
    assert len(response.sources) == 2
    assert len(response.citations) == 2

    # ── QueryLog persisted (immutable audit) ────────────────────────────────
    logs = (await db_session.execute(
        select(QueryLog).where(QueryLog.workspace_id == request.workspace_id)
    )).scalars().all()
    assert len(logs) == 1
    log = logs[0]
    assert log.query_text == request.query
    assert "$383.3B" in log.answer_text
    assert log.confidence_score == pytest.approx(0.94)
    assert log.model_used == "llama-3.1-70b-versatile"
    # The chunk ids list is JSON-serialised text
    assert "chunk-pipe-1" in log.source_chunk_ids
    assert "chunk-pipe-2" in log.source_chunk_ids


@pytest.mark.asyncio
async def test_query_pipeline_empty_candidates(monkeypatch, db_session, pipeline_workspace):
    """Zero candidates → friendly fallback message AND a QueryLog row at confidence 0."""
    from app.services.rag import pipeline as pipeline_module

    monkeypatch.setattr("app.core.config.settings.GROQ_API_KEY", "gsk_test_stub")

    async def fake_retrieve(req, db, top_k=None):
        return []

    request = QueryRequest(
        query="Question with no matching documents",
        workspace_id=pipeline_workspace["workspace"].id,
        top_k=5,
    )

    with patch("app.services.rag.retriever.retrieve", fake_retrieve):
        response = await pipeline_module.run_query_pipeline(
            request=request, user_id="test-user-id", db=db_session,
        )

    assert "No relevant documents" in response.answer
    assert response.confidence == 0.0
    assert response.sources == []
    assert response.model_used == "none"

    # Even for empty answers, the audit row is written
    rows = (await db_session.execute(
        select(QueryLog).where(QueryLog.workspace_id == request.workspace_id)
    )).scalars().all()
    assert len(rows) == 1
    assert rows[0].confidence_score == 0.0


@pytest.mark.asyncio
async def test_query_pipeline_reranker_failure_falls_back_to_rrf(
    monkeypatch, db_session, pipeline_workspace
):
    """If the cross-encoder explodes, the pipeline still answers using RRF order."""
    from app.services.rag import pipeline as pipeline_module

    monkeypatch.setattr("app.core.config.settings.GROQ_API_KEY", "gsk_test_stub")

    async def fake_retrieve(req, db, top_k=None):
        return [{**c, "rerank_score": None} for c in _RERANKED]

    async def boom_rerank(query, candidates, top_n=None):
        raise RuntimeError("cross-encoder OOM")

    captured: dict = {}

    async def fake_generate(query, reranked_chunks, model=None):
        captured["count"] = len(reranked_chunks)
        return dict(_GENERATION)

    async def fake_audit(**kwargs):
        return None

    with patch("app.services.rag.retriever.retrieve", fake_retrieve), \
         patch("app.services.rag.reranker.rerank", boom_rerank), \
         patch("app.services.rag.generator.generate_answer", fake_generate), \
         patch("app.services.audit.write_comprehensive_audit_log", fake_audit):

        response = await pipeline_module.run_query_pipeline(
            request=QueryRequest(
                query="anything",
                workspace_id=pipeline_workspace["workspace"].id,
                top_k=5,
            ),
            user_id="test-user-id",
            db=db_session,
        )

    # Generation still ran with the original RRF order
    assert captured["count"] >= 1
    assert response.answer.startswith("Apple's revenue")


@pytest.mark.asyncio
async def test_query_pipeline_requires_groq_api_key(monkeypatch, db_session, pipeline_workspace):
    """Without a GROQ_API_KEY the pipeline must fail loudly before doing any work."""
    from app.services.rag import pipeline as pipeline_module

    monkeypatch.setattr("app.core.config.settings.GROQ_API_KEY", "")

    request = QueryRequest(
        query="anything",
        workspace_id=pipeline_workspace["workspace"].id,
        top_k=5,
    )

    with pytest.raises(RuntimeError, match="GROQ_API_KEY"):
        await pipeline_module.run_query_pipeline(
            request=request, user_id="test-user-id", db=db_session,
        )


# ── HTTP-level integration: POST /api/v1/queries ─────────────────────────────
@pytest.mark.asyncio
async def test_post_queries_endpoint_full_stack(monkeypatch, client, pipeline_workspace):
    """End-to-end through the FastAPI route, with the heavy services stubbed out."""
    monkeypatch.setattr("app.core.config.settings.GROQ_API_KEY", "gsk_test_stub")

    async def fake_retrieve(req, db, top_k=None):
        return [{**c, "rerank_score": None} for c in _RERANKED]

    async def fake_rerank(query, candidates, top_n=None):
        return _RERANKED[: (top_n or len(_RERANKED))]

    async def fake_generate(query, reranked_chunks, model=None):
        return dict(_GENERATION)

    async def fake_audit(**kwargs):
        return None

    with patch("app.services.rag.retriever.retrieve", fake_retrieve), \
         patch("app.services.rag.reranker.rerank", fake_rerank), \
         patch("app.services.rag.generator.generate_answer", fake_generate), \
         patch("app.services.audit.write_comprehensive_audit_log", fake_audit):

        response = await client.post(
            "/api/v1/queries",
            json={
                "query": "What was Apple's revenue in FY2023?",
                "workspace_id": pipeline_workspace["workspace"].id,
                "top_k": 5,
            },
            headers={"Authorization": "Bearer stub-token"},
        )

    assert response.status_code == 200, response.text
    body = response.json()

    assert "$383.3B" in body["answer"]
    assert body["confidence"] == pytest.approx(0.94)
    assert body["model_used"] == "llama-3.1-70b-versatile"
    assert len(body["sources"]) == 2
    assert len(body["citations"]) == 2
    assert body["citations"][0]["page_number"] == 27
    assert body["sources"][0]["document_id"] == "doc-pipe-1"


@pytest.mark.asyncio
async def test_post_queries_rejects_unknown_workspace(monkeypatch, client):
    """Workspace ownership is enforced at the route level — unknown ws → 404."""
    monkeypatch.setattr("app.core.config.settings.GROQ_API_KEY", "gsk_test_stub")

    response = await client.post(
        "/api/v1/queries",
        json={
            "query": "anything at all",
            "workspace_id": "ws-does-not-exist",
            "top_k": 5,
        },
        headers={"Authorization": "Bearer stub-token"},
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_query_history_endpoint_returns_logged_query(
    monkeypatch, client, db_session, pipeline_workspace
):
    """After running a query, GET /queries/history should surface the audit row."""
    monkeypatch.setattr("app.core.config.settings.GROQ_API_KEY", "gsk_test_stub")

    async def fake_retrieve(req, db, top_k=None):
        return [{**c, "rerank_score": None} for c in _RERANKED]

    async def fake_rerank(query, candidates, top_n=None):
        return _RERANKED[: (top_n or len(_RERANKED))]

    async def fake_generate(query, reranked_chunks, model=None):
        return dict(_GENERATION)

    async def fake_audit(**kwargs):
        return None

    with patch("app.services.rag.retriever.retrieve", fake_retrieve), \
         patch("app.services.rag.reranker.rerank", fake_rerank), \
         patch("app.services.rag.generator.generate_answer", fake_generate), \
         patch("app.services.audit.write_comprehensive_audit_log", fake_audit):

        # 1. Run a query
        post = await client.post(
            "/api/v1/queries",
            json={
                "query": "What was Apple's gross margin?",
                "workspace_id": pipeline_workspace["workspace"].id,
                "top_k": 5,
            },
            headers={"Authorization": "Bearer stub-token"},
        )
        assert post.status_code == 200

        # 2. Fetch history
        hist = await client.get(
            f"/api/v1/queries/history?workspace_id={pipeline_workspace['workspace'].id}",
            headers={"Authorization": "Bearer stub-token"},
        )

    assert hist.status_code == 200
    body = hist.json()
    assert body["total"] >= 1
    assert any("gross margin" in item["query"] for item in body["items"])
    assert all(item["model"] == "llama-3.1-70b-versatile" for item in body["items"])
