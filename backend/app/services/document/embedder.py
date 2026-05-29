"""
Embedder service — PostgreSQL pgvector edition.

Stores dense embeddings (sentence-transformers/all-MiniLM-L6-v2, 384-dim)
directly in the ``chunk_embeddings`` table in PostgreSQL.  No external
vector store service required — pgvector is a PostgreSQL extension that
ships with standard PostgreSQL 15+.

Pipeline integration
--------------------
After chunking, embed_and_index_chunks() is called with the list of
chunker.Chunk dataclasses.  Each chunk's dense vector is upserted into
``chunk_embeddings`` (keyed on chunk_id, so re-runs are idempotent).
The legacy ``chunks.pinecone_id`` column is re-used to store the
deterministic point UUID so the retriever's join query is unchanged.

Public API
----------
``embed_and_index_chunks(...)``  — embed all chunks for a document.
``delete_document_vectors(...)`` — purge a document's embeddings on delete.
"""
from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING

from sqlalchemy import select

from app.core.config import settings
from app.db.models import Chunk as ChunkModel, Document, DocumentStatus
from app.services.rag import pg_vector_store

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
    """Embed chunks and upsert them to ``chunk_embeddings`` in PostgreSQL.

    Returns the number of rows upserted.
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
        "Embedding %d chunks for document_id=%s model=%s",
        len(chunks), document_id, settings.EMBEDDING_MODEL,
    )

    try:
        batch_size = 100
        total_upserted = 0

        for batch_start in range(0, len(chunks), batch_size):
            batch = chunks[batch_start: batch_start + batch_size]
            texts = [c.text for c in batch]

            # Dense embedding — CPU-bound, offloaded to thread pool.
            dense_vectors = await asyncio.to_thread(_embed_dense, texts)

            # Build the rows for pg_vector_store.upsert_embeddings.
            rows = []
            for c, dense_vec in zip(batch, dense_vectors):
                point_id = pg_vector_store.point_id_for(document_id, c.chunk_index)
                rows.append({
                    "chunk_id":    c.chunk_index,  # resolved to DB id below
                    "document_id": document_id,
                    "workspace_id": workspace_id,
                    "point_id":    point_id,
                    "embedding":   dense_vec,
                })

            # Resolve chunk dataclass indices → Postgres chunk UUIDs in one query.
            db_chunks_batch = (await db.execute(
                select(ChunkModel)
                .where(
                    ChunkModel.document_id == document_id,
                    ChunkModel.chunk_index.in_([c.chunk_index for c in batch]),
                )
                .order_by(ChunkModel.chunk_index)
            )).scalars().all()

            index_to_id = {ch.chunk_index: ch.id for ch in db_chunks_batch}

            # Patch chunk_id with the real UUID and write back point_id.
            valid_rows = []
            for row, c in zip(rows, batch):
                chunk_uuid = index_to_id.get(c.chunk_index)
                if chunk_uuid is None:
                    log.warning(
                        "No DB chunk found for document_id=%s chunk_index=%d — skipping",
                        document_id, c.chunk_index,
                    )
                    continue
                row["chunk_id"] = chunk_uuid
                valid_rows.append(row)

            if valid_rows:
                await pg_vector_store.upsert_embeddings(valid_rows, db)

            # Write point_id back to chunks.pinecone_id so the retriever join works.
            for ch in db_chunks_batch:
                ch.pinecone_id = pg_vector_store.point_id_for(document_id, ch.chunk_index)
                ch.embedding_model = settings.EMBEDDING_MODEL

            total_upserted += len(valid_rows)

            log.debug(
                "Embedded batch doc=%s range=%d–%d",
                document_id, batch_start, batch_start + len(batch),
            )

        doc.status = DocumentStatus.INDEXED
        await db.commit()

        log.info(
            "Indexing complete: document_id=%s vectors=%d", document_id, total_upserted,
        )
        return total_upserted

    except Exception as exc:
        # Mark the document FAILED in a *fresh* session — the existing one may
        # be in a half-rolled-back state if the upsert raised mid-commit.
        log.exception(
            "Embedding/indexing failed for document_id=%s — marking FAILED",
            document_id,
        )
        try:
            from app.db.session import AsyncSessionLocal

            async with AsyncSessionLocal() as fail_db:
                fail_doc = (await fail_db.execute(
                    select(Document).where(Document.id == document_id)
                )).scalar_one_or_none()
                if fail_doc is not None:
                    fail_doc.status = DocumentStatus.FAILED
                    fail_doc.error_message = f"Embedding stage failed: {exc}"
                    await fail_db.commit()
        except Exception as commit_exc:
            log.error(
                "Could not mark document_id=%s as FAILED: %s",
                document_id, commit_exc,
            )
        raise


# ── Deletion ──────────────────────────────────────────────────────────────────
async def delete_document_vectors(
    document_id: str,
    workspace_id: str,
    chunk_count: int,
    db: "AsyncSession | None" = None,
) -> None:
    """Remove all pgvector embedding rows for a document.

    ``workspace_id`` and ``chunk_count`` are kept in the signature for
    backwards compatibility with the existing route call site.
    A fresh session is opened when ``db`` is not supplied.
    """
    try:
        if db is not None:
            await pg_vector_store.delete_by_document_id(document_id, db)
        else:
            from app.db.session import AsyncSessionLocal
            async with AsyncSessionLocal() as fresh_db:
                await pg_vector_store.delete_by_document_id(document_id, fresh_db)
                await fresh_db.commit()
    except Exception as exc:
        log.error("pgvector delete failed for document_id=%s: %s", document_id, exc)
