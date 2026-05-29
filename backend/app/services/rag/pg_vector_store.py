"""
PostgreSQL pgvector store — replaces the Qdrant backend.

All vectors live in the ``chunk_embeddings`` table alongside the rest of
the application data in PostgreSQL.  No extra service to run, no port to
expose, no .exe to download.

Schema (see alembic/versions/0006_add_chunk_embeddings.py):
------------------------------------------------------------
  chunk_embeddings
    id            UUID PK
    chunk_id      FK → chunks.id  ON DELETE CASCADE
    document_id   FK → documents.id  ON DELETE CASCADE (for fast bulk deletes)
    workspace_id  VARCHAR index
    embedding     VECTOR(384)   — dense cosine embedding
    created_at    TIMESTAMPTZ

Public API
----------
  ensure_table()                          → no-op (migration owns schema)
  upsert_embeddings(rows)                 → INSERT … ON CONFLICT DO UPDATE
  delete_by_document_id(document_id, db)  → DELETE WHERE document_id = …
  cosine_search(query_vec, workspace_id, doc_ids, top_k, db) → list[hit]
"""
from __future__ import annotations

import logging
import uuid
from typing import TYPE_CHECKING

from sqlalchemy import text

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

log = logging.getLogger(__name__)

# pgvector extension must exist in the DB (created by migration 0006).
# The extension adds the <=> operator and VECTOR type.


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
        chunk_id, document_id, workspace_id, embedding (list[float])

    Returns the number of rows upserted.
    """
    if not rows:
        return 0

    # Build a single multi-row INSERT … ON CONFLICT statement.
    # We use raw SQL because SQLAlchemy's ORM layer doesn't yet support
    # pgvector VECTOR literals natively without a custom type mapper.
    values_clauses = []
    params: dict = {}

    for i, row in enumerate(rows):
        vec_str = "[" + ",".join(str(v) for v in row["embedding"]) + "]"
        values_clauses.append(
            f"(:chunk_id_{i}::uuid, :doc_id_{i}::uuid, :ws_id_{i}, :point_id_{i}::uuid, "
            f":vec_{i}::vector, NOW())"
        )
        params[f"chunk_id_{i}"]  = row["chunk_id"]
        params[f"doc_id_{i}"]    = row["document_id"]
        params[f"ws_id_{i}"]     = row["workspace_id"]
        params[f"point_id_{i}"]  = row["point_id"]
        params[f"vec_{i}"]       = vec_str

    sql = text(
        "INSERT INTO chunk_embeddings "
        "  (chunk_id, document_id, workspace_id, point_id, embedding, created_at) "
        "VALUES " + ", ".join(values_clauses) + " "
        "ON CONFLICT (chunk_id) DO UPDATE "
        "  SET embedding = EXCLUDED.embedding, "
        "      document_id = EXCLUDED.document_id, "
        "      workspace_id = EXCLUDED.workspace_id, "
        "      point_id = EXCLUDED.point_id, "
        "      created_at = EXCLUDED.created_at"
    )

    await db.execute(sql, params)
    log.debug("upsert_embeddings: %d rows", len(rows))
    return len(rows)


# ── Cosine similarity search ──────────────────────────────────────────────────
async def cosine_search(
    query_vec: list[float],
    workspace_id: str,
    document_ids: list[str] | None,
    top_k: int,
    db: "AsyncSession",
) -> list[dict]:
    """Return the top_k most similar chunks for ``query_vec``.

    Uses the pgvector ``<=>`` cosine-distance operator.  Distance is
    converted to similarity score (1 − distance) so callers get a 0–1
    score where 1 = identical.

    Returns a list of dicts with:
        chunk_id, document_id, workspace_id, point_id, score
    """
    vec_str = "[" + ",".join(str(v) for v in query_vec) + "]"

    params: dict = {
        "workspace_id": workspace_id,
        "query_vec": vec_str,
        "top_k": top_k,
    }

    doc_filter = ""
    if document_ids:
        doc_placeholders = ", ".join(f":doc_id_{i}" for i in range(len(document_ids)))
        doc_filter = f"AND ce.document_id::text IN ({doc_placeholders})"
        for i, doc_id in enumerate(document_ids):
            params[f"doc_id_{i}"] = doc_id

    sql = text(
        f"""
        SELECT
            ce.chunk_id::text,
            ce.document_id::text,
            ce.workspace_id,
            ce.point_id::text,
            1 - (ce.embedding <=> :query_vec::vector) AS score
        FROM chunk_embeddings ce
        WHERE ce.workspace_id = :workspace_id
          {doc_filter}
        ORDER BY ce.embedding <=> :query_vec::vector
        LIMIT :top_k
        """
    )

    result = await db.execute(sql, params)
    rows = result.fetchall()

    return [
        {
            "chunk_id":    row.chunk_id,
            "document_id": row.document_id,
            "workspace_id": row.workspace_id,
            "point_id":    row.point_id,
            "score":       float(row.score),
        }
        for row in rows
    ]


# ── Delete ────────────────────────────────────────────────────────────────────
async def delete_by_document_id(document_id: str, db: "AsyncSession") -> None:
    """Remove all embedding rows for a document."""
    await db.execute(
        text("DELETE FROM chunk_embeddings WHERE document_id = :doc_id::uuid"),
        {"doc_id": document_id},
    )
    log.info("pg_vector_store: deleted embeddings for document_id=%s", document_id)
