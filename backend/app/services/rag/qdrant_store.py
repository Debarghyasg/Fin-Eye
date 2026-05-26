"""
Qdrant vector-store adapter — replaces the ChromaDB layer.

The PDF spec (§0) calls out three Qdrant features that drive this design:

  1. **Native hybrid search** — dense + BM25 sparse vectors live in the same
     collection and are queried in a single round-trip with server-side
     Reciprocal Rank Fusion. The ``rank-bm25``-on-top-of-Redis layer is
     therefore *deleted*, not refactored — it is no longer needed.

  2. **ACORN-style filtered search** — a ``workspace_id`` payload filter
     stays fast even when it eliminates 99% of points, so cross-tenant
     leakage is prevented at the infrastructure level rather than the app
     level.

  3. **Production parity** — Qdrant collections map 1:1 to Pinecone
     namespaces, so the production swap is "change ``QDRANT_URL`` to a
     Pinecone host and ``QDRANT_API_KEY`` to a Pinecone key." No business
     logic moves.

Vector layout
-------------
A single collection holds **both** vector kinds via Qdrant's named-vector
feature:

    vectors_config = {
        "dense":  VectorParams(size=384, distance=COSINE),
    }
    sparse_vectors_config = {
        "sparse": SparseVectorParams(),
    }

* **Dense** is produced by the existing local ``sentence-transformers``
  MiniLM model so we do not change the embedding stack — just the storage
  backend.
* **Sparse** is produced by ``fastembed``'s ``Qdrant/bm25`` model. fastembed
  is a tiny sibling library shipped with ``qdrant-client[fastembed]`` and
  runs entirely on CPU.

Point IDs
---------
Qdrant point IDs must be unsigned ints or UUIDs. To keep deletes cheap we
derive a deterministic UUID5 from the legacy ``"{document_id}_{chunk_index}"``
string the rest of the codebase already uses, and we copy it back into the
``chunks.pinecone_id`` Postgres column. That column is the join key
between Postgres and Qdrant — its name is now historical, but renaming it
is a separate, larger migration.
"""
from __future__ import annotations

import logging
import uuid
from typing import Any, Iterable

from app.core.config import settings

log = logging.getLogger(__name__)


# ── Singletons ────────────────────────────────────────────────────────────────
_client = None                  # type: ignore[var-annotated]   QdrantClient
_collection_ready = False
_sparse_model = None            # type: ignore[var-annotated]   SparseTextEmbedding


def get_client():
    """Return the process-wide QdrantClient, creating it on first call."""
    global _client
    if _client is None:
        from qdrant_client import QdrantClient

        kwargs: dict[str, Any] = {"url": settings.QDRANT_URL, "timeout": 30}
        if settings.QDRANT_API_KEY:
            kwargs["api_key"] = settings.QDRANT_API_KEY
        _client = QdrantClient(**kwargs)
        log.info("Qdrant client initialised: %s", settings.QDRANT_URL)
    return _client


def _get_sparse_model():
    """Lazy-load fastembed BM25 (downloads tokenizer on first call, ~2 MB)."""
    global _sparse_model
    if _sparse_model is None:
        from fastembed import SparseTextEmbedding

        log.info("Loading sparse model %r", settings.QDRANT_SPARSE_MODEL)
        _sparse_model = SparseTextEmbedding(model_name=settings.QDRANT_SPARSE_MODEL)
    return _sparse_model


# ── Collection bootstrap ──────────────────────────────────────────────────────
def ensure_collection() -> None:
    """Create the Qdrant collection on first use. Idempotent."""
    global _collection_ready
    if _collection_ready:
        return

    from qdrant_client.http import models as qm

    client = get_client()
    name = settings.QDRANT_COLLECTION

    if client.collection_exists(name):
        _collection_ready = True
        log.debug("Qdrant collection %r already exists", name)
        return

    client.create_collection(
        collection_name=name,
        vectors_config={
            settings.QDRANT_DENSE_VECTOR_NAME: qm.VectorParams(
                size=settings.EMBEDDING_DIMENSION,
                distance=qm.Distance.COSINE,
                # On-disk HNSW keeps memory bounded for the dev container.
                on_disk=True,
            ),
        },
        sparse_vectors_config={
            settings.QDRANT_SPARSE_VECTOR_NAME: qm.SparseVectorParams(
                # On-disk inverted index — faster cold start, slightly slower queries.
                index=qm.SparseIndexParams(on_disk=True),
            ),
        },
        # Per-payload indexes drive the workspace_id ACORN filter — without
        # these the filter falls back to a linear scan and kills latency.
        on_disk_payload=True,
    )

    # Add payload indexes after creation. Doing this in a separate call keeps
    # the create_collection signature readable and lets us extend the index
    # set without re-creating the collection.
    for field, schema in (
        ("workspace_id", qm.PayloadSchemaType.KEYWORD),
        ("document_id",  qm.PayloadSchemaType.KEYWORD),
        ("ticker",       qm.PayloadSchemaType.KEYWORD),
        ("page_number",  qm.PayloadSchemaType.INTEGER),
    ):
        try:
            client.create_payload_index(
                collection_name=name, field_name=field, field_schema=schema,
            )
        except Exception as exc:  # pragma: no cover - defensive
            log.warning("create_payload_index(%s) failed: %s", field, exc)

    _collection_ready = True
    log.info(
        "Qdrant collection %r created (dim=%d, dense=%s, sparse=%s)",
        name, settings.EMBEDDING_DIMENSION,
        settings.QDRANT_DENSE_VECTOR_NAME, settings.QDRANT_SPARSE_VECTOR_NAME,
    )


# ── ID derivation ─────────────────────────────────────────────────────────────
_POINT_ID_NAMESPACE = uuid.UUID("00000000-0000-0000-0000-000000000001")


def point_id_for(document_id: str, chunk_index: int) -> str:
    """Deterministic UUID5 derived from the legacy ``{doc}_{idx}`` string."""
    return str(uuid.uuid5(_POINT_ID_NAMESPACE, f"{document_id}_{chunk_index}"))


# ── Encoders ──────────────────────────────────────────────────────────────────
def encode_sparse_one(text: str):
    """Return a single fastembed SparseEmbedding for ``text``."""
    model = _get_sparse_model()
    # SparseTextEmbedding.embed yields one SparseEmbedding per input.
    return next(iter(model.embed([text])))


def encode_sparse_batch(texts: list[str]) -> list[Any]:
    """Embed a batch of texts with the sparse BM25 model."""
    model = _get_sparse_model()
    return list(model.embed(texts))


def to_qdrant_sparse_vector(emb):
    """Convert a fastembed SparseEmbedding into a Qdrant SparseVector."""
    from qdrant_client.http import models as qm
    return qm.SparseVector(
        indices=emb.indices.tolist(),
        values=emb.values.tolist(),
    )


# ── Filter helpers ────────────────────────────────────────────────────────────
def workspace_filter(workspace_id: str, document_ids: Iterable[str] | None = None):
    """Build a Qdrant Filter restricting points to a workspace (and docs)."""
    from qdrant_client.http import models as qm

    must = [
        qm.FieldCondition(
            key="workspace_id",
            match=qm.MatchValue(value=workspace_id),
        ),
    ]
    doc_list = list(document_ids) if document_ids else []
    if doc_list:
        must.append(
            qm.FieldCondition(
                key="document_id",
                match=qm.MatchAny(any=doc_list),
            )
        )
    return qm.Filter(must=must)


# ── Mutating ops used by the indexing pipeline ────────────────────────────────
def upsert_points(points: list[Any]) -> None:
    """Wait-for-ack upsert. Caller is responsible for batching."""
    client = get_client()
    client.upsert(
        collection_name=settings.QDRANT_COLLECTION,
        points=points,
        wait=True,
    )


def delete_by_document_id(document_id: str) -> None:
    """Remove every point belonging to a document — used on hard delete."""
    from qdrant_client.http import models as qm

    client = get_client()
    client.delete(
        collection_name=settings.QDRANT_COLLECTION,
        points_selector=qm.FilterSelector(
            filter=qm.Filter(
                must=[
                    qm.FieldCondition(
                        key="document_id",
                        match=qm.MatchValue(value=document_id),
                    )
                ]
            )
        ),
        wait=True,
    )
    log.info("Qdrant points purged for document_id=%s", document_id)
