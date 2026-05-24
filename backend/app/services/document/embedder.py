"""
Embedder service — Week 3.

Responsibilities
----------------
1. Call OpenAI text-embedding-3-large in batches of 100 chunks.
2. Upsert resulting vectors into Pinecone with rich metadata.
3. Write pinecone_id + embedding_model back to each Chunk row in Postgres.
4. Advance document.status → INDEXED.
5. On document delete, remove all vectors from Pinecone.

Pinecone vector metadata stored per chunk
-----------------------------------------
  document_id   : str
  workspace_id  : str
  chunk_index   : int
  chunk_type    : "prose" | "table" | "header"
  page_number   : int | None
  source_section: str | None
  text          : str          (first 1000 chars — for display without DB hit)
  ticker        : str | None
  fiscal_period : str | None

Namespace
---------
  Each workspace gets its own Pinecone namespace = workspace_id.
  This gives free isolation without needing a separate index per workspace.
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

# ── Pinecone client singleton ─────────────────────────────────────────────────
_pinecone_index = None


def _get_index():
    """Return a cached Pinecone Index object. Initialised once per process."""
    global _pinecone_index
    if _pinecone_index is None:
        from pinecone import Pinecone
        pc = Pinecone(api_key=settings.PINECONE_API_KEY)
        _pinecone_index = pc.Index(settings.PINECONE_INDEX_NAME)
        log.info("Pinecone index %r connected", settings.PINECONE_INDEX_NAME)
    return _pinecone_index


# ── OpenAI embeddings ─────────────────────────────────────────────────────────
def _embed_batch(texts: list[str]) -> list[list[float]]:
    """
    Call OpenAI embeddings API for a batch of texts.
    Returns a list of float vectors, same order as input.
    """
    from openai import OpenAI
    client = OpenAI(api_key=settings.OPENAI_API_KEY)
    response = client.embeddings.create(
        model=settings.OPENAI_EMBEDDING_MODEL,
        input=texts,
        encoding_format="float",
    )
    # Response items are sorted by index
    return [item.embedding for item in sorted(response.data, key=lambda x: x.index)]


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
    Embed all chunks for a document and upsert into Pinecone.

    - Batches OpenAI calls in groups of 100 (API limit).
    - Upserts to Pinecone namespace = workspace_id.
    - Updates chunk.pinecone_id + chunk.embedding_model in DB.
    - Sets document.status = INDEXED.

    Returns the number of vectors upserted.
    """
    if not chunks:
        log.warning("embed_and_index_chunks called with 0 chunks for doc %s", document_id)
        return 0

    if not settings.PINECONE_API_KEY or not settings.OPENAI_API_KEY:
        raise RuntimeError(
            "PINECONE_API_KEY and OPENAI_API_KEY must be set in .env before embedding."
        )

    index = _get_index()
    namespace = workspace_id
    batch_size = 100
    total_upserted = 0

    # ── Update status → EMBEDDING ─────────────────────────────────────────────
    result = await db.execute(select(Document).where(Document.id == document_id))
    doc = result.scalar_one()
    doc.status = DocumentStatus.EMBEDDING
    await db.commit()

    log.info(
        "Starting embedding: document_id=%s chunks=%d model=%s",
        document_id, len(chunks), settings.OPENAI_EMBEDDING_MODEL,
    )

    # ── Process in batches ────────────────────────────────────────────────────
    for batch_start in range(0, len(chunks), batch_size):
        batch = chunks[batch_start : batch_start + batch_size]
        texts = [c.text for c in batch]

        # Call OpenAI (blocking — run in thread to avoid blocking event loop)
        vectors = await asyncio.to_thread(_embed_batch, texts)

        # Build Pinecone upsert payload
        upsert_vectors = []
        for chunk_data, vector in zip(batch, vectors):
            pinecone_id = f"{document_id}_{chunk_data.chunk_index}"
            upsert_vectors.append({
                "id": pinecone_id,
                "values": vector,
                "metadata": {
                    "document_id":    document_id,
                    "workspace_id":   workspace_id,
                    "chunk_index":    chunk_data.chunk_index,
                    "chunk_type":     chunk_data.chunk_type.value,
                    "page_number":    chunk_data.page_number or 0,
                    "source_section": chunk_data.source_section or "",
                    "text":           chunk_data.text[:1000],   # truncate for metadata
                    "ticker":         ticker or "",
                    "fiscal_period":  fiscal_period or "",
                },
            })

        # Upsert to Pinecone (blocking)
        await asyncio.to_thread(
            index.upsert,
            vectors=upsert_vectors,
            namespace=namespace,
        )
        total_upserted += len(upsert_vectors)

        log.debug(
            "Upserted batch %d-%d (%d vectors) for doc %s",
            batch_start, batch_start + len(batch), len(upsert_vectors), document_id,
        )

    # ── Update DB: write pinecone_id to each chunk row ────────────────────────
    chunk_results = await db.execute(
        select(ChunkModel)
        .where(ChunkModel.document_id == document_id)
        .order_by(ChunkModel.chunk_index)
    )
    db_chunks = chunk_results.scalars().all()

    for db_chunk in db_chunks:
        db_chunk.pinecone_id = f"{document_id}_{db_chunk.chunk_index}"
        db_chunk.embedding_model = settings.OPENAI_EMBEDDING_MODEL

    # ── Advance document status → INDEXED ─────────────────────────────────────
    doc.status = DocumentStatus.INDEXED
    await db.commit()

    log.info(
        "Embedding complete: document_id=%s vectors_upserted=%d namespace=%s",
        document_id, total_upserted, namespace,
    )
    return total_upserted


# ── Delete vectors on document removal ───────────────────────────────────────
async def delete_document_vectors(
    document_id: str,
    workspace_id: str,
    chunk_count: int,
) -> None:
    """
    Delete all Pinecone vectors for a document.

    Pinecone IDs follow the pattern: {document_id}_{chunk_index}
    We delete by prefix using delete(ids=[...], namespace=workspace_id).
    """
    if not settings.PINECONE_API_KEY:
        log.warning("PINECONE_API_KEY not set — skipping vector deletion for %s", document_id)
        return

    try:
        index = _get_index()
        namespace = workspace_id

        # Build all IDs that could exist for this document
        ids_to_delete = [f"{document_id}_{i}" for i in range(chunk_count)]

        # Pinecone delete accepts up to 1000 IDs per call
        batch_size = 1000
        for i in range(0, len(ids_to_delete), batch_size):
            batch = ids_to_delete[i : i + batch_size]
            await asyncio.to_thread(
                index.delete,
                ids=batch,
                namespace=namespace,
            )

        log.info(
            "Deleted %d Pinecone vectors for document_id=%s namespace=%s",
            len(ids_to_delete), document_id, namespace,
        )
    except Exception as exc:
        # Non-fatal — log but don't fail the delete request
        log.error("Pinecone vector deletion failed for %s: %s", document_id, exc)
