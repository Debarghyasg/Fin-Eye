"""
Unit tests for the Qdrant-backed hybrid retriever (PR 2).

The retriever in production talks to:

  1. The dense ``sentence-transformers`` MiniLM model
  2. The fastembed ``Qdrant/bm25`` sparse model
  3. A live Qdrant collection (with server-side RRF)

None of those are appropriate to spin up in a unit-test process — the
models are slow to download and Qdrant needs its own container. Each test
stubs the boundary it needs and exercises one of the three behaviours that
matter at the app layer:

  * ``_qdrant_hybrid_search`` builds the right ``query_points`` request:
    workspace filter on every prefetch, document_ids filter when supplied,
    and ``Fusion.RRF`` for the merge query.
  * ``_enrich_with_db`` joins Qdrant point ids back to ``Chunk`` rows and
    silently skips orphans.
  * ``retrieve`` handles a Qdrant outage by returning an empty list rather
    than 500-ing the request.
"""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
import pytest_asyncio

from app.db.models import Chunk, ChunkType, Document, DocumentStatus, DocumentType, Workspace
from app.db.schemas import QueryRequest


# ── Helpers ───────────────────────────────────────────────────────────────────
class _FakeQdrantClient:
    """Records the last call to query_points and returns a canned response."""

    def __init__(self, points):
        self._points = points
        self.last_kwargs: dict = {}

    def query_points(self, **kwargs):
        self.last_kwargs = kwargs
        return SimpleNamespace(points=self._points)


def _make_hit(point_id: str, score: float, payload: dict):
    return SimpleNamespace(id=point_id, score=score, payload=payload)


class _FakeEmbedModel:
    """Stand-in for SentenceTransformer.encode()."""

    def encode(self, texts, show_progress_bar=False, **kwargs):
        import numpy as np
        return np.array([[0.1, 0.2, 0.3, 0.4] for _ in texts], dtype="float32")


class _FakeSparseEmbedding:
    """fastembed-shape sparse embedding."""

    def __init__(self, indices=(1, 5, 9), values=(0.5, 0.3, 0.2)):
        import numpy as np
        self.indices = np.array(indices)
        self.values = np.array(values)


# ── Fixture: workspace + 2 documents + chunks ─────────────────────────────────
@pytest_asyncio.fixture
async def populated_workspace(db_session):
    """Insert workspace + 2 documents, each with 3 chunks. Mirrors how chunks
    are created by the indexing pipeline (pinecone_id = uuid5("{doc}_{idx}"))."""
    from app.services.rag import qdrant_store

    ws = Workspace(id="ws-retr", owner_id="test-user-id", name="Retriever WS", is_default=True)
    db_session.add(ws)
    await db_session.flush()

    doc_a = Document(
        id="doc-A", workspace_id=ws.id, original_filename="A.pdf",
        mime_type="application/pdf", file_size_bytes=1000,
        doc_type=DocumentType.TEN_K, status=DocumentStatus.INDEXED,
    )
    doc_b = Document(
        id="doc-B", workspace_id=ws.id, original_filename="B.pdf",
        mime_type="application/pdf", file_size_bytes=1000,
        doc_type=DocumentType.TEN_Q, status=DocumentStatus.INDEXED,
    )
    db_session.add_all([doc_a, doc_b])
    await db_session.flush()

    chunks = []
    for doc in (doc_a, doc_b):
        for i in range(3):
            chunks.append(Chunk(
                id=f"chunk-{doc.id}-{i}",
                document_id=doc.id,
                text=f"Body of {doc.id} chunk {i} discussing revenue and margins.",
                chunk_type=ChunkType.PROSE,
                chunk_index=i,
                page_number=i + 1,
                source_section="MD&A",
                # Same point-id derivation the embedder uses.
                pinecone_id=qdrant_store.point_id_for(doc.id, i),
            ))
    db_session.add_all(chunks)
    await db_session.commit()

    return {"workspace": ws, "doc_a": doc_a, "doc_b": doc_b}


# ── Hybrid query construction ─────────────────────────────────────────────────
def test_qdrant_hybrid_search_uses_rrf_fusion_and_workspace_filter():
    """The Qdrant call must use Fusion.RRF and apply the workspace filter."""
    from qdrant_client.http import models as qm

    from app.services.rag import retriever, qdrant_store

    fake_hits = [_make_hit("pid-A", 0.91, {"document_id": "doc-A"})]
    fake_client = _FakeQdrantClient(fake_hits)

    sparse_vec = qm.SparseVector(indices=[1, 2], values=[0.4, 0.3])

    with patch.object(qdrant_store, "get_client", return_value=fake_client):
        results = retriever._qdrant_hybrid_search(
            dense_vec=[0.1, 0.2, 0.3, 0.4],
            sparse_vec=sparse_vec,
            workspace_id="ws-1",
            document_ids=None,
            top_k=5,
        )

    kwargs = fake_client.last_kwargs
    assert kwargs["limit"] == 5
    # Two prefetches: dense + sparse, each with the workspace filter
    prefetches = kwargs["prefetch"]
    assert len(prefetches) == 2
    using_names = {p.using for p in prefetches}
    assert using_names == {"dense", "sparse"}
    for p in prefetches:
        # Every prefetch must filter by workspace_id
        conditions = p.filter.must
        assert any(
            getattr(c, "key", None) == "workspace_id"
            for c in conditions
        )
    # The fused query is RRF
    assert isinstance(kwargs["query"], qm.FusionQuery)
    assert kwargs["query"].fusion == qm.Fusion.RRF

    # And the response is mapped to the canonical hit shape
    assert results[0]["chunk_id"] == "pid-A"
    assert results[0]["rrf_score"] == pytest.approx(0.91)
    assert results[0]["metadata"]["document_id"] == "doc-A"


def test_qdrant_hybrid_search_applies_document_filter():
    """When document_ids is supplied the prefetch filter gains a doc-match clause."""
    from app.services.rag import retriever, qdrant_store

    fake_client = _FakeQdrantClient([])

    with patch.object(qdrant_store, "get_client", return_value=fake_client):
        retriever._qdrant_hybrid_search(
            dense_vec=[0.1, 0.2, 0.3, 0.4],
            sparse_vec=MagicMock(),
            workspace_id="ws-1",
            document_ids=["doc-A", "doc-B"],
            top_k=5,
        )

    prefetch = fake_client.last_kwargs["prefetch"][0]
    keys = {getattr(c, "key", None) for c in prefetch.filter.must}
    assert "workspace_id" in keys
    assert "document_id" in keys


# ── Postgres enrichment ───────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_enrich_with_db_loads_text_and_skips_unknown(db_session, populated_workspace):
    """Hits whose pinecone_id matches a chunk row get full text; orphans dropped."""
    from app.services.rag.retriever import _enrich_with_db
    from app.services.rag.qdrant_store import point_id_for

    candidates = [
        {"chunk_id": point_id_for("doc-A", 0), "rrf_score": 0.5, "dense_score": 0.0, "sparse_score": 0.0},
        {"chunk_id": "00000000-0000-0000-0000-deadbeef0000", "rrf_score": 0.4, "dense_score": 0.0, "sparse_score": 0.0},
        {"chunk_id": point_id_for("doc-B", 2), "rrf_score": 0.3, "dense_score": 0.0, "sparse_score": 0.0},
    ]
    enriched = await _enrich_with_db(candidates, db_session)

    qdrant_ids = [e["qdrant_id"] for e in enriched]
    assert point_id_for("doc-A", 0) in qdrant_ids
    assert point_id_for("doc-B", 2) in qdrant_ids
    # Orphan (no DB row) is silently skipped
    assert "00000000-0000-0000-0000-deadbeef0000" not in qdrant_ids

    a0 = next(e for e in enriched if e["qdrant_id"] == point_id_for("doc-A", 0))
    assert "Body of doc-A" in a0["text"]
    assert a0["document_id"] == "doc-A"
    assert a0["page_number"] == 1


# ── retrieve(): graceful failure ─────────────────────────────────────────────
@pytest.mark.asyncio
async def test_retrieve_returns_empty_when_qdrant_raises(db_session, populated_workspace):
    """A Qdrant outage must not 500 the request — return [] for the generator to handle."""
    from app.services.rag import retriever

    request = QueryRequest(query="anything", workspace_id="ws-retr", top_k=5)

    def boom(*args, **kwargs):
        raise RuntimeError("qdrant is on fire")

    with patch("app.services.rag.retriever._embed_query_dense", return_value=[0.0] * 4), \
         patch("app.services.rag.retriever._embed_query_sparse", return_value=MagicMock()), \
         patch("app.services.rag.retriever._qdrant_hybrid_search", side_effect=boom):
        results = await retriever.retrieve(request, db_session, top_k=5)

    assert results == []


@pytest.mark.asyncio
async def test_retrieve_end_to_end_with_stubbed_hybrid(db_session, populated_workspace):
    """retrieve() composes encoders + hybrid search + DB enrichment."""
    from app.services.rag import retriever
    from app.services.rag.qdrant_store import point_id_for

    request = QueryRequest(query="What was revenue?", workspace_id="ws-retr", top_k=5)

    fake_hits = [
        {"chunk_id": point_id_for("doc-A", 0), "rrf_score": 0.95, "dense_score": 0.0, "sparse_score": 0.0, "metadata": {}},
        {"chunk_id": point_id_for("doc-B", 1), "rrf_score": 0.80, "dense_score": 0.0, "sparse_score": 0.0, "metadata": {}},
    ]

    with patch("app.services.rag.retriever._embed_query_dense", return_value=[0.0] * 4), \
         patch("app.services.rag.retriever._embed_query_sparse", return_value=MagicMock()), \
         patch("app.services.rag.retriever._qdrant_hybrid_search", return_value=fake_hits):
        results = await retriever.retrieve(request, db_session, top_k=5)

    qdrant_ids = [r["qdrant_id"] for r in results]
    assert point_id_for("doc-A", 0) in qdrant_ids
    assert point_id_for("doc-B", 1) in qdrant_ids
    # First hit retains highest RRF score
    assert results[0]["qdrant_id"] == point_id_for("doc-A", 0)
    assert results[0]["rrf_score"] == pytest.approx(0.95)
