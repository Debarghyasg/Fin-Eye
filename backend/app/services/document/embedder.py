"""
Embedder service — FREE stack.

Uses sentence-transformers/all-MiniLM-L6-v2 (local CPU, 384-dim, ~90 MB).
Stores vectors in ChromaDB running in Docker (persistent on disk).

Flow per document
-----------------
1. Load the local SentenceTransformer model (singleton, loaded once per process).
2. Encode all chunks in batches of 100.
3. Upsert vectors into ChromaDB collection.
   - collection name  : settings.CHROMA_COLLECTION
   - namespace        : metadata field  workspace_id  (ChromaDB has no native namespace)
   - vector id        : "{document_id}_{chunk_index}"
4. Write the ChromaDB ID back to each Chunk row in Postgres.
5. Advance document.status → INDEXED.

On document delete → delete all vectors by document_id metadata filter.
"""
from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING

from sqlalchemy import select

from app.core.config import settings
from app.db.models import Chunk as ChunkModel, Document, DocumentStatus

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession
    from app.services.document.chunker import Chunk as ChunkDataclass

log = logging.getLogger(__name__)

# ── Singleton: SentenceTransformer model ─────────────────────────────────────
_embed_model = None


def _get_embed_model():
    global _embed_model
    if _embed_model is None:
        from sentence_transformers import SentenceTransformer
        log.info(
            "Loading embedding model %r — first call may take 30s to download ~90 MB",
            settings.EMBEDDING_MODEL,
        )
        _embed_model = SentenceTransformer(settings.EMBEDDING_MODEL)
        log.info("Embedding model loaded (dim=%d)", settings.EMBEDDING_DIMENSION)
    return _embed_model


# ── Singleton: ChromaDB client ────────────────────────────────────────────────
_chroma_collection = None


def _get_collection():
    global _chroma_collection
    if _chroma_collection is None:
        import chromadb
        client = chromadb.HttpClient(
            host=settings.CHROMA_HOST,
            port=settings.CHROMA_PORT,
        )
        _chroma_collection = client.get_or_create_collection(
            name=settings.CHROMA_COLLECTION,
            metadata={"hnsw:space": "cosine"},
        )
        log.info(
            "ChromaDB collection %r ready at %s:%d",
            settings.CHROMA_COLLECTION,
            settings.CHROMA_HOST,
            settings.CHROMA_PORT,
        )
    return _chroma_collection


# ── Embed batch (CPU-bound) ───────────────────────────────────────────────────
def _embed_texts(texts: list[str]) -> list[list[float]]:
    model = _get_embed_model()
    vectors = model.encode(texts, batch_size=64, show_progress_bar=False)
    return vectors.tolist()


# ── Main entry point ──────────────────────────────────────────────────────────
async def embed_and_index_chunks(
    chunks: list["ChunkDataclass"],
    document_id: str,
    workspace_id: str,
    ticker: str | None,
    fiscal_period: str | None,
    db: "AsyncSession",
) -> int:
    """
    Embed all chunks for a document and upsert into ChromaDB.

    Returns the number of vectors upserted.
    """
    if not chunks:
        log.warning("embed_and_index_chunks: 0 chunks for doc %s", document_id)
        return 0

    # ── Mark EMBEDDING ────────────────────────────────────────────────────────
    result = await db.execute(select(Document).where(Document.id == document_id))
    doc = result.scalar_one()
    doc.status = DocumentStatus.EMBEDDING
    await db.commit()

    log.info(
        "Embedding %d chunks for document_id=%s model=%s",
        len(chunks), document_id, settings.EMBEDDING_MODEL,
    )

    batch_size = 100
    total_upserted = 0
    collection = _get_collection()

    for batch_start in range(0, len(chunks), batch_size):
        batch = chunks[batch_start : batch_start + batch_size]
        texts = [c.text for c in batch]

        # Encode on CPU in thread pool
        vectors = await asyncio.to_thread(_embed_texts, texts)

        ids = [f"{document_id}_{c.chunk_index}" for c in batch]
        metadatas = [
            {
                "document_id":    document_id,
                "workspace_id":   workspace_id,
                "chunk_index":    c.chunk_index,
                "chunk_type":     c.chunk_type.value,
                "page_number":    c.page_number or 0,
                "source_section": c.source_section or "",
                "ticker":         ticker or "",
                "fiscal_period":  fiscal_period or "",
                # Store first 500 chars for display without DB hit
                "text_preview":   c.text[:500],
            }
            for c in batch
        ]

        # ChromaDB upsert (blocking → thread pool)
        await asyncio.to_thread(
            collection.upsert,
            ids=ids,
            embeddings=vectors,
            metadatas=metadatas,
            documents=texts,   # ChromaDB stores full text too
        )
        total_upserted += len(batch)
        log.debug("Upserted batch %d–%d for doc %s", batch_start, batch_start + len(batch), document_id)

    # ── Write ChromaDB IDs back to Postgres Chunk rows ────────────────────────
    chunk_results = await db.execute(
        select(ChunkModel)
        .where(ChunkModel.document_id == document_id)
        .order_by(ChunkModel.chunk_index)
    )
    for db_chunk in chunk_results.scalars().all():
        db_chunk.pinecone_id = f"{document_id}_{db_chunk.chunk_index}"  # reuse column
        db_chunk.embedding_model = settings.EMBEDDING_MODEL

    # ── Advance to INDEXED ────────────────────────────────────────────────────
    doc.status = DocumentStatus.INDEXED
    await db.commit()

    log.info(
        "Indexing complete: document_id=%s vectors=%d",
        document_id, total_upserted,
    )
    return total_upserted


# ── Delete vectors on document removal ───────────────────────────────────────
async def delete_document_vectors(
    document_id: str,
    workspace_id: str,
    chunk_count: int,
) -> None:
    """Delete all ChromaDB vectors for a document."""
    try:
        collection = _get_collection()
        ids = [f"{document_id}_{i}" for i in range(chunk_count)]

        # ChromaDB delete accepts a list of IDs
        batch_size = 500
        for i in range(0, len(ids), batch_size):
            await asyncio.to_thread(collection.delete, ids=ids[i : i + batch_size])

        log.info(
            "Deleted %d ChromaDB vectors for document_id=%s",
            len(ids), document_id,
        )
    except Exception as exc:
        log.error("ChromaDB vector deletion failed for %s: %s", document_id, exc)
