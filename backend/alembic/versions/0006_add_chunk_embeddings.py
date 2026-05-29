"""add chunk_embeddings table (plain PostgreSQL — no pgvector extension)

Revision ID: 0006_chunk_embeddings
Revises: 0005_audit_logs
Create Date: 2026-05-29

Creates the ``chunk_embeddings`` table that stores one 384-dimensional dense
embedding per chunk.  The embedding is stored as a JSON-encoded ``TEXT``
column so this works on a **vanilla PostgreSQL install with zero extensions**
(and on SQLite for tests).

Why not pgvector?
-----------------
The previous version of this migration required the pgvector extension
(``CREATE EXTENSION vector`` + ``VECTOR(384)`` + an IVFFlat index).  pgvector
is not bundled with standard PostgreSQL and is painful to install on Windows,
which made startup migrations fail and silently broke the whole ingestion
pipeline (the table was never created).

For a local, single-workspace tool the corpus is small (hundreds to a few
thousand chunks), so cosine similarity is computed in Python at query time
(see ``app/services/rag/pg_vector_store.py``).  Brute-force cosine over a few
thousand 384-dim vectors is sub-50ms — no ANN index needed.  If this ever
needs to scale, swap the column to ``VECTOR(384)`` and add an IVFFlat/HNSW
index in a follow-up migration on a pgvector-enabled database.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0006_chunk_embeddings"
down_revision: Union[str, None] = "0005_audit_logs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "chunk_embeddings",
        sa.Column("id",           sa.String(36),               nullable=False),
        sa.Column("chunk_id",     sa.String(36),               nullable=False),
        sa.Column("document_id",  sa.String(36),               nullable=False),
        sa.Column("workspace_id", sa.String(36),               nullable=False),
        sa.Column("point_id",     sa.String(36),               nullable=False),
        # JSON-encoded list[float] of length EMBEDDING_DIMENSION (384).
        # TEXT keeps this dependency-free on every backend.
        sa.Column("embedding",    sa.Text(),                   nullable=False),
        sa.Column("created_at",   sa.DateTime(timezone=True),  nullable=False),

        sa.ForeignKeyConstraint(["chunk_id"],     ["chunks.id"],     ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["document_id"],  ["documents.id"],  ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )

    # One embedding per chunk (unique) + fast filters for search/delete.
    op.create_index(
        "ix_chunk_embeddings_chunk_id",
        "chunk_embeddings", ["chunk_id"],
        unique=True,
    )
    op.create_index("ix_chunk_embeddings_document_id",  "chunk_embeddings", ["document_id"])
    op.create_index("ix_chunk_embeddings_workspace_id", "chunk_embeddings", ["workspace_id"])
    op.create_index("ix_chunk_embeddings_point_id",     "chunk_embeddings", ["point_id"])


def downgrade() -> None:
    op.drop_index("ix_chunk_embeddings_point_id",     table_name="chunk_embeddings")
    op.drop_index("ix_chunk_embeddings_workspace_id", table_name="chunk_embeddings")
    op.drop_index("ix_chunk_embeddings_document_id",  table_name="chunk_embeddings")
    op.drop_index("ix_chunk_embeddings_chunk_id",     table_name="chunk_embeddings")
    op.drop_table("chunk_embeddings")
