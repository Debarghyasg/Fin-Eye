"""
PostgreSQL vector store — plain SQL + in-Python cosine (no pgvector).

All embeddings live in the ``chunk_embeddings`` table as JSON-encoded
``TEXT``.  Similarity search fetches the candidate vectors for a workspace
and ranks them in Python with NumPy.  This needs **zero PostgreSQL
extensions**, so it runs on a vanilla install (including Windows) with no
setup beyond the standard migrations.

Performance note
----------------
For a local, single-workspace tool the corpus is small (hundreds to a few
thousand chunks).  Brute-force cosine over a few thousand 384-dim vectors is
sub-50ms.  If this ever needs to scale to hundreds of thousands of chunks,
swap the embedding column to pgvector's ``VECTOR(384)`` and replace
``cosine_search`` with an indexed ``<=>`` query — the public API here stays
the same.

Public API
----------
  point_id_for(document_id, chunk_index)        → deterministic UUID5
  upsert_embeddings(rows, db)                    → insert/replace embeddings
  cosine_search(query_vec, workspace_id, doc_ids, top_k, db) → list[hit]
  delete_by_document_id(document_id, db)         → DELETE WHERE document_id = …
"""
from __future__ import annotations

import json
import logging
import uuid
from typing import TYPE_CHECKING

from sqlalchemy import select

from app.db.models import ChunkEmbedding

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

log = logging.getLogger(__name__)


# ── ID derivation (kept identical to the old Qdrant scheme) ──────────────────
_POINT_ID_NAMESPACE = uuid.UUID("00000000-0000-0000-0000-000000000001")


def point_id_for(document_id: str, chunk_index: int) -> str:
    """Deterministic UUID5 from ``{document_id}_{chunk_index}``."""
    return str(uuid.uuid5(_POINT_ID_NAMESPACE, f"{document_id}_{chunk_index}"))


# ── Upsert ────────────────────────────────────────────────────────────────────
async def upsert_embeddings(
    rows: list[dict],
    db: "AsyncSession",
) -> int:
    """Insert or replace embedding rows.

    Each dict in ``rows`` must have:
        chunk_id, document_id, workspace_id, point_id, embedding (list[float])

    The embedding is JSON-encoded into the TEXT column.  Existing rows for the
    same chunk_id are deleted first (dialect-agnostic upsert) so re-running the
    pipeline is idempotent.

    Returns the number of rows written.
    """
    if not rows:
        return 0

    chunk_ids = [r["chunk_id"] for r in rows]

    # Delete any pre-existing embeddings for these chunks (idempotent re-runs).
    existing = (await db.execute(
        select(ChunkEmbedding).where(ChunkEmbedding.chunk_id.in_(chunk_ids))
    )).scalars().all()
    for row in existing:
        await db.delete(row)
    if existing:
        await db.flush()

    db.add_all([
        ChunkEmbedding(
            chunk_id=r["chunk_id"],
            document_id=r["document_id"],
            workspace_id=r["workspace_id"],
            point_id=r["point_id"],
            embedding=json.dumps(r["embedding"]),
        )
        for r in rows
    ])
    await db.flush()

    log.debug("upsert_embeddings: %d rows", len(rows))
    return len(rows)


# ── Cosine similarity search (in Python) ──────────────────────────────────────
def _cosine(a: "list[float]", b: "list[float]") -> float:
    """Cosine similarity of two equal-length vectors. Pure NumPy."""
    import numpy as np

    va = np.asarray(a, dtype=np.float32)
    vb = np.asarray(b, dtype=np.float32)
    denom = (np.linalg.norm(va) * np.linalg.norm(vb))
    if denom == 0.0:
        return 0.0
    return float(np.dot(va, vb) / denom)


async def cosine_search(
    query_vec: list[float],
    workspace_id: str,
    document_ids: list[str] | None,
    top_k: int,
    db: "AsyncSession",
) -> list[dict]:
    """Return the top_k most similar chunks for ``query_vec``.

    Fetches all embeddings for the workspace (optionally restricted to a set
    of document_ids), computes cosine similarity in Python, and returns the
    highest-scoring rows.

    Returns a list of dicts with:
        chunk_id, document_id, workspace_id, point_id, score (0–1)
    """
    import numpy as np

    stmt = select(ChunkEmbedding).where(ChunkEmbedding.workspace_id == workspace_id)
    if document_ids:
        stmt = stmt.where(ChunkEmbedding.document_id.in_(document_ids))

    candidates = (await db.execute(stmt)).scalars().all()
    if not candidates:
        return []

    q = np.asarray(query_vec, dtype=np.float32)
    q_norm = float(np.linalg.norm(q))
    if q_norm == 0.0:
        return []

    scored: list[dict] = []
    for ce in candidates:
        try:
            vec = json.loads(ce.embedding)
        except (TypeError, ValueError):
            log.warning("Skipping chunk_embedding %s with unparseable vector", ce.id)
            continue
        v = np.asarray(vec, dtype=np.float32)
        v_norm = float(np.linalg.norm(v))
        if v_norm == 0.0:
            continue
        score = float(np.dot(q, v) / (q_norm * v_norm))
        scored.append({
            "chunk_id":     ce.chunk_id,
            "document_id":  ce.document_id,
            "workspace_id": ce.workspace_id,
            "point_id":     ce.point_id,
            "score":        score,
        })

    scored.sort(key=lambda x: x["score"], reverse=True)
    return scored[:top_k]


# ── Delete ────────────────────────────────────────────────────────────────────
async def delete_by_document_id(document_id: str, db: "AsyncSession") -> None:
    """Remove all embedding rows for a document."""
    rows = (await db.execute(
        select(ChunkEmbedding).where(ChunkEmbedding.document_id == document_id)
    )).scalars().all()
    for row in rows:
        await db.delete(row)
    await db.flush()
    log.info("pg_vector_store: deleted %d embeddings for document_id=%s", len(rows), document_id)
