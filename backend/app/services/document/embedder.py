"""
Embedder service — Week 3 stub.

This module will generate dense vector embeddings for each chunk using
OpenAI's text-embedding-3-large model, then upsert them into Pinecone.

Week 3 implementation checklist:
  [ ] Batch chunks into groups of 100 (OpenAI rate limit)
  [ ] Call openai.embeddings.create(model=settings.OPENAI_EMBEDDING_MODEL, ...)
  [ ] Upsert vectors into Pinecone index with chunk metadata as payload
  [ ] Update chunk.pinecone_id and chunk.embedding_model in DB
  [ ] Update document.status → DocumentStatus.INDEXED

The interface is defined here now so the pipeline and route code can
import and call it without modification in Week 3.
"""
from __future__ import annotations

import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession
    from app.services.document.chunker import Chunk

log = logging.getLogger(__name__)


async def embed_and_index_chunks(
    chunks: list["Chunk"],
    document_id: str,
    db: "AsyncSession",
) -> int:
    """
    Embed all chunks and upsert into Pinecone.

    Returns the number of vectors successfully upserted.

    STUB — raises NotImplementedError until Week 3.
    """
    raise NotImplementedError(
        "embed_and_index_chunks() is not implemented yet. "
        "Implement in Week 3 once Pinecone and OpenAI are configured."
    )


async def delete_document_vectors(document_id: str) -> None:
    """
    Delete all Pinecone vectors for a given document.

    Called when a document is deleted from the workspace.

    STUB — raises NotImplementedError until Week 3.
    """
    raise NotImplementedError(
        "delete_document_vectors() is not implemented yet. "
        "Implement in Week 3."
    )
