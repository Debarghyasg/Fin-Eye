"""
Unit tests for the hybrid retriever — Week 11.

The retriever talks to three external systems we DO NOT want in unit tests:

  1. The SentenceTransformer embedding model    → ~90 MB download, slow on CPU
  2. ChromaDB                                   → requires the chromadb container
  3. Redis-cached BM25 index                    → requires redis + a built corpus

So these tests stub all three and exercise:

  - The pure RRF merge function with deterministic ranks
  - ChromaDB filter construction (workspace_id always, document_ids when set)
  - The retrieval pipeline end-to-end against a fake collection + fake BM25
  - DB enrichment behaviour (full-text fetch, missing-row skip)
  - Graceful degradation when ChromaDB raises
"""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
import pytest_asyncio

from app.db.models import Chunk, ChunkType, Document, DocumentStatus, DocumentType, Workspace
from app.db.schemas import QueryRequest


# ── Helpers ───────────────────────────────────────────────────────────────────
def _make_chroma_response(ids: list[str], distances: list[float], metadatas: list[dict]):
    """Build the dict shape returned by chromadb.Collection.query()."""
    return {
        "ids":       [ids],
        "distances": [distances],
        "metadatas": [metadatas],
        "documents": [["text-" + i for i in ids]],
    }


class _FakeCollection:
    """Stand-in for chromadb.Collection used in retrieval."""

    def __init__(self, response: dict, count: int = 100):
        self._response = response
        self._count = count
        self.last_kwargs: dict = {}

    def query(self, **kwargs):
        self.last_kwargs = kwargs
        return self._response

    def count(self) -> int:
        return self._count


class _FakeEmbedModel:
    """Stand-in for SentenceTransformer.encode()."""

    def encode(self, texts, show_progress_bar=False, **kwargs):
        # Return a deterministic 4-dim vector per input string
        import numpy as np
        return np.array([[0.1, 0.2, 0.3, 0.4] for _ in texts], dtype="float32")


# ── Fixture: workspace + 2 documents + chunks ─────────────────────────────────
@pytest_asyncio.fixture
async def populated_workspace(db_session):
    """Insert workspace + 2 documents, each with 3 chunks. Mirrors how chunks
    are created by the indexing pipeline (pinecone_id = '{doc}_{idx}')."""
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
                pinecone_id=f"{doc.id}_{i}",   # same id format ChromaDB stores
            ))
    db_session.add_all(chunks)
    await db_session.commit()

    return {"workspace": ws, "doc_a": doc_a, "doc_b": doc_b}


# ── Pure: RRF merge ──────────────────────────────────────────────────────────
def test_rrf_merge_combines_dense_and_sparse():
    """A chunk that ranks high in BOTH lists should beat a chunk that ranks high in only one."""
    from app.services.rag.retriever import _rrf_merge

    dense = [
        {"chunk_id": "X", "score": 0.95, "rank": 0, "metadata": {}},
        {"chunk_id": "Y", "score": 0.80, "rank": 1, "metadata": {}},
    ]
    sparse = [
        {"chunk_id": "Y", "score": 5.0, "rank": 0},
        {"chunk_id": "Z", "score": 4.0, "rank": 1},
    ]
    merged = _rrf_merge(dense, sparse, k=60)

    by_id = {item["chunk_id"]: item for item in merged}
    # Y appears in both → must outrank X (only dense) and Z (only sparse)
    assert merged[0]["chunk_id"] == "Y"
    # All three carry separate dense/sparse score fields
    assert by_id["X"]["dense_score"] == 0.95 and by_id["X"]["sparse_score"] == 0.0
    assert by_id["Z"]["dense_score"] == 0.0 and by_id["Z"]["sparse_score"] == 4.0
    # And Y has both populated
    assert by_id["Y"]["dense_score"] == 0.80
    assert by_id["Y"]["sparse_score"] == 5.0


def test_rrf_merge_handles_empty_inputs():
    """Both empty → empty list; one empty → other list passes through ordered."""
    from app.services.rag.retriever import _rrf_merge

    assert _rrf_merge([], [], k=60) == []

    only_dense = _rrf_merge(
        [{"chunk_id": "A", "score": 0.5, "rank": 0, "metadata": {}}],
        [],
        k=60,
    )
    assert len(only_dense) == 1
    assert only_dense[0]["chunk_id"] == "A"


def test_rrf_score_decreases_with_rank():
    """Same-list, lower-rank chunks must outrank higher-rank chunks."""
    from app.services.rag.retriever import _rrf_merge

    dense = [
        {"chunk_id": f"id_{i}", "score": 1.0 - 0.1 * i, "rank": i, "metadata": {}}
        for i in range(5)
    ]
    merged = _rrf_merge(dense, [], k=60)
    ids_in_order = [m["chunk_id"] for m in merged]
    assert ids_in_order == ["id_0", "id_1", "id_2", "id_3", "id_4"]


# ── Filter logic: ChromaDB where-clause construction ─────────────────────────
def test_chroma_query_filters_by_workspace_only():
    """No document_ids → simple workspace_id eq filter."""
    from app.services.rag import retriever

    fake_resp = _make_chroma_response(
        ids=["doc-A_0"], distances=[0.1],
        metadatas=[{"workspace_id": "ws-1"}],
    )
    fake_coll = _FakeCollection(fake_resp)

    with patch("app.services.document.embedder._get_collection", return_value=fake_coll):
        results = retriever._chroma_query(
            vector=[0.1, 0.2, 0.3, 0.4],
            workspace_id="ws-1",
            top_k=5,
            document_ids=None,
        )

    where = fake_coll.last_kwargs["where"]
    assert where == {"workspace_id": {"$eq": "ws-1"}}
    # And the response is converted to similarity = 1 - distance
    assert results[0]["chunk_id"] == "doc-A_0"
    assert results[0]["score"] == pytest.approx(0.9)
    assert results[0]["rank"] == 0


def test_chroma_query_filters_by_document_ids():
    """document_ids set → AND-filter with $in clause."""
    from app.services.rag import retriever

    fake_resp = _make_chroma_response(
        ids=["doc-A_0", "doc-A_1"], distances=[0.1, 0.2],
        metadatas=[{}, {}],
    )
    fake_coll = _FakeCollection(fake_resp)

    with patch("app.services.document.embedder._get_collection", return_value=fake_coll):
        retriever._chroma_query(
            vector=[0.1, 0.2, 0.3, 0.4],
            workspace_id="ws-1",
            top_k=5,
            document_ids=["doc-A", "doc-B"],
        )

    where = fake_coll.last_kwargs["where"]
    assert "$and" in where
    clauses = where["$and"]
    assert {"workspace_id": {"$eq": "ws-1"}} in clauses
    assert {"document_id":  {"$in": ["doc-A", "doc-B"]}} in clauses


def test_chroma_query_clamps_distance_to_zero_floor():
    """Negative similarity (distance > 1) is clamped to 0.0."""
    from app.services.rag import retriever

    fake_resp = _make_chroma_response(
        ids=["doc-A_0"], distances=[1.7],
        metadatas=[{}],
    )
    fake_coll = _FakeCollection(fake_resp)

    with patch("app.services.document.embedder._get_collection", return_value=fake_coll):
        results = retriever._chroma_query(
            vector=[0.0] * 4, workspace_id="ws-1", top_k=5, document_ids=None,
        )

    assert results[0]["score"] == 0.0


# ── Enrichment: text fetched from Postgres ────────────────────────────────────
@pytest.mark.asyncio
async def test_enrich_with_db_loads_text_and_skips_unknown(db_session, populated_workspace):
    """Candidates with a known chunk_id get full text; unknown IDs are dropped."""
    from app.services.rag.retriever import _enrich_with_db

    candidates = [
        {"chunk_id": "doc-A_0", "rrf_score": 0.5, "dense_score": 0.9, "sparse_score": 0.0},
        {"chunk_id": "missing_99", "rrf_score": 0.4, "dense_score": 0.8, "sparse_score": 0.0},
        {"chunk_id": "doc-B_2", "rrf_score": 0.3, "dense_score": 0.0, "sparse_score": 4.5},
    ]
    enriched = await _enrich_with_db(candidates, db_session)

    chroma_ids = [e["chroma_id"] for e in enriched]
    assert "doc-A_0" in chroma_ids
    assert "doc-B_2" in chroma_ids
    assert "missing_99" not in chroma_ids   # silently skipped

    a0 = next(e for e in enriched if e["chroma_id"] == "doc-A_0")
    assert "Body of doc-A" in a0["text"]
    assert a0["document_id"] == "doc-A"
    assert a0["page_number"] == 1
    assert a0["dense_score"] == 0.9


# ── Full pipeline: retrieve() with everything mocked ─────────────────────────
@pytest.mark.asyncio
async def test_retrieve_end_to_end(db_session, populated_workspace):
    """retrieve() should: embed query → call Chroma → call BM25 → RRF → enrich."""
    from app.services.rag import retriever

    fake_chroma_resp = _make_chroma_response(
        ids=["doc-A_0", "doc-B_1"], distances=[0.10, 0.30],
        metadatas=[{"document_id": "doc-A"}, {"document_id": "doc-B"}],
    )
    fake_coll = _FakeCollection(fake_chroma_resp)
    fake_model = _FakeEmbedModel()

    async def fake_bm25(query, workspace_id, top_k, document_ids=None):
        return [
            {"chunk_id": "doc-B_1", "score": 6.0, "rank": 0},  # also in dense
            {"chunk_id": "doc-A_2", "score": 4.0, "rank": 1},  # sparse-only
        ]

    request = QueryRequest(
        query="What was revenue?",
        workspace_id="ws-retr",
        top_k=5,
    )

    with patch("app.services.document.embedder._get_embed_model", return_value=fake_model), \
         patch("app.services.document.embedder._get_collection", return_value=fake_coll), \
         patch("app.services.rag.retriever.query_bm25", fake_bm25):
        results = await retriever.retrieve(request, db_session, top_k=5)

    chroma_ids = [r["chroma_id"] for r in results]
    # All three IDs were enriched
    assert "doc-A_0" in chroma_ids
    assert "doc-B_1" in chroma_ids
    assert "doc-A_2" in chroma_ids
    # doc-B_1 ranks first because it appears in BOTH dense and sparse
    assert results[0]["chroma_id"] == "doc-B_1"


@pytest.mark.asyncio
async def test_retrieve_uses_document_ids_filter(db_session, populated_workspace):
    """When the request restricts to a document, that filter must reach Chroma."""
    from app.services.rag import retriever

    fake_resp = _make_chroma_response(
        ids=["doc-A_0"], distances=[0.05], metadatas=[{}],
    )
    fake_coll = _FakeCollection(fake_resp)
    fake_model = _FakeEmbedModel()

    async def fake_bm25(query, workspace_id, top_k, document_ids=None):
        return []

    request = QueryRequest(
        query="risk factors",
        workspace_id="ws-retr",
        document_ids=["doc-A"],
        top_k=5,
    )

    with patch("app.services.document.embedder._get_embed_model", return_value=fake_model), \
         patch("app.services.document.embedder._get_collection", return_value=fake_coll), \
         patch("app.services.rag.retriever.query_bm25", fake_bm25):
        await retriever.retrieve(request, db_session, top_k=5)

    where = fake_coll.last_kwargs["where"]
    assert "$and" in where
    assert {"document_id": {"$in": ["doc-A"]}} in where["$and"]


@pytest.mark.asyncio
async def test_retrieve_falls_back_when_chroma_fails(db_session, populated_workspace):
    """If ChromaDB raises, dense results are empty but BM25 results still flow through."""
    from app.services.rag import retriever

    fake_model = _FakeEmbedModel()

    def boom(*args, **kwargs):
        raise RuntimeError("chroma is on fire")

    async def fake_bm25(query, workspace_id, top_k, document_ids=None):
        return [{"chunk_id": "doc-A_1", "score": 7.5, "rank": 0}]

    request = QueryRequest(query="anything", workspace_id="ws-retr", top_k=5)

    with patch("app.services.document.embedder._get_embed_model", return_value=fake_model), \
         patch("app.services.rag.retriever._chroma_query", side_effect=boom), \
         patch("app.services.rag.retriever.query_bm25", fake_bm25):
        results = await retriever.retrieve(request, db_session, top_k=5)

    # We still get the BM25 hit back, enriched with full text
    assert len(results) == 1
    assert results[0]["chroma_id"] == "doc-A_1"
    assert results[0]["dense_score"] == 0.0
    assert results[0]["sparse_score"] > 0.0
