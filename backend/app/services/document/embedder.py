"""
Embedder service — Qdrant edition (PR 2).

Replaces the previous ChromaDB integration with Qdrant + fastembed BM25
sparse vectors. Every chunk is upserted with **two** vectors in a single
collection:

    dense  → sentence-transformers/all-MiniLM-L6-v2  (384-dim, cosine)
    sparse → fastembed Qdrant/bm25                   (BM25 on the chunk text)

Hybrid retrieval (see ``retriever.py``) then queries both server-side and
the Reciprocal Rank Fusion is performed inside Qdrant — no per-workspace
BM25 index has to be rebuilt anywhere.

Pipeline integration
--------------------
The chunker writes chunks to Postgres with ``id = uuid4()``. Here we
overwrite the legacy ``chunks.pinecone_id`` column with the Qdrant point
id (a UUID5 derived from ``"{doc}_{idx}"``) so retriever joins can find
the row from a Qdrant hit.

Public API
----------
``embed_and_index_chunks(...)``  → upsert all chunks for a document.
``delete_document_vectors(...)`` → purge a document's points on hard delete.
"""
from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING

from sqlalchemy import select

from app.core.config import settings
from app.db.models import Chunk as ChunkModel, Document, DocumentStatus

from app.services.rag import qdrant_store

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession
    from app.services.document.chunker import Chunk as ChunkDataclass

log = logging.getLogger(__name__)

# ── Dense embedding model singleton ──────────────────────────────────────────
_embed_model = None


def _get_embed_model():
    """Process-local SentenceTransformer (loaded once, reused for life of worker)."""
    global _embed_model
    if _embed_model is None:
        from sentence_transformers import SentenceTransformer
        log.info(
            "Loading dense model %r — first call may take 30s to download ~90 MB",
            settings.EMBEDDING_MODEL,
        )
        _embed_model = SentenceTransformer(settings.EMBEDDING_MODEL)
        log.info("Dense model loaded (dim=%d)", settings.EMBEDDING_DIMENSION)
    return _embed_model


def _embed_dense(texts: list[str]) -> list[list[float]]:
    """Encode a batch of texts to dense vectors. Pure CPU work, no I/O."""
    model = _get_embed_model()
    vectors = model.encode(texts, batch_size=64, show_progress_bar=False)
    return vectors.tolist()


# ── Indexing ──────────────────────────────────────────────────────────────────
async def embed_and_index_chunks(
    chunks: list["ChunkDataclass"],
    document_id: str,
    workspace_id: str,
    ticker: str | None,
    fiscal_period: str | None,
    db: "AsyncSession",
) -> int:
    """Embed chunks (dense + sparse) and upsert them to Qdrant.

    Returns the number of points upserted.
    """
    if not chunks:
        log.warning("embed_and_index_chunks: 0 chunks for doc %s", document_id)
        return 0

    # Mark the document as embedding so the frontend status poller reflects it.
    doc = (await db.execute(
        select(Document).where(Document.id == document_id)
    )).scalar_one()
    doc.status = DocumentStatus.EMBEDDING
    await db.commit()

    log.info(
        "Embedding %d chunks for document_id=%s dense=%s sparse=%s",
        len(chunks), document_id, settings.EMBEDDING_MODEL, settings.QDRANT_SPARSE_MODEL,
    )

    # The collection might be missing if this is the first ever upsert in a
    # fresh deployment. Cheap idempotent check.
    await asyncio.to_thread(qdrant_store.ensure_collection)

    batch_size = 100
    total_upserted = 0

    for batch_start in range(0, len(chunks), batch_size):
        batch = chunks[batch_start: batch_start + batch_size]
        texts = [c.text for c in batch]

        # Compute dense + sparse in parallel threads — both are CPU-bound.
        dense_task = asyncio.to_thread(_embed_dense, texts)
        sparse_task = asyncio.to_thread(qdrant_store.encode_sparse_batch, texts)
        dense_vectors, sparse_embs = await asyncio.gather(dense_task, sparse_task)

        # Build PointStructs in the worker thread (avoids importing qdrant
        # types inside this async function for clarity).
        def _build_points():
            from qdrant_client.http import models as qm

            points = []
            for c, dense_vec, sparse_emb in zip(batch, dense_vectors, sparse_embs):
                points.append(qm.PointStruct(
                    id=qdrant_store.point_id_for(document_id, c.chunk_index),
                    vector={
                        settings.QDRANT_DENSE_VECTOR_NAME: dense_vec,
                        settings.QDRANT_SPARSE_VECTOR_NAME:
                            qdrant_store.to_qdrant_sparse_vector(sparse_emb),
                    },
                    payload={
                        "document_id":    document_id,
                        "workspace_id":   workspace_id,
                        "chunk_index":    c.chunk_index,
                        "chunk_type":     c.chunk_type.value,
                        "page_number":    c.page_number or 0,
                        "source_section": c.source_section or "",
                        "ticker":         ticker or "",
                        "fiscal_period":  fiscal_period or "",
                        "text_preview":   c.text[:500],
                    },
                ))
            return points

        points = await asyncio.to_thread(_build_points)
        await asyncio.to_thread(qdrant_store.upsert_points, points)

        total_upserted += len(batch)
        log.debug(
            "Qdrant upsert: doc=%s range=%d–%d",
            document_id, batch_start, batch_start + len(batch),
        )

    # Write Qdrant point IDs back to Postgres so the retriever can look up
    # full chunk text from a hit. The legacy column name is preserved.
    db_chunks = (await db.execute(
        select(ChunkModel)
        .where(ChunkModel.document_id == document_id)
        .order_by(ChunkModel.chunk_index)
    )).scalars().all()
    for db_chunk in db_chunks:
        db_chunk.pinecone_id = qdrant_store.point_id_for(document_id, db_chunk.chunk_index)
        db_chunk.embedding_model = settings.EMBEDDING_MODEL

    doc.status = DocumentStatus.INDEXED
    await db.commit()

    log.info(
        "Indexing complete: document_id=%s vectors=%d", document_id, total_upserted,
    )
    return total_upserted


# ── Deletion ──────────────────────────────────────────────────────────────────
async def delete_document_vectors(
    document_id: str,
    workspace_id: str,
    chunk_count: int,
) -> None:
    """Remove all Qdrant points for a document.

    ``chunk_count`` is no longer required (Qdrant deletes by filter), but is
    kept in the signature so the existing route call site does not have to
    change in the same PR as the storage swap.
    """
    try:
        await asyncio.to_thread(qdrant_store.delete_by_document_id, document_id)
    except Exception as exc:
        log.error("Qdrant delete failed for document_id=%s: %s", document_id, exc)
