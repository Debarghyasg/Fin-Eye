"""add chunk_embeddings table for pgvector (replaces Qdrant)

Revision ID: 0006_chunk_embeddings
Revises: 0005_audit_logs
Create Date: 2026-05-29

Installs the pgvector extension and creates the ``chunk_embeddings`` table
that stores one 384-dimensional dense embedding per chunk.  All similarity
search now runs inside PostgreSQL — no external vector store service needed.

Requirements
------------
  PostgreSQL 15+ with the pgvector extension available:
    CREATE EXTENSION IF NOT EXISTS vector;

  If pgvector is not installed:
    Ubuntu/Debian : sudo apt install postgresql-15-pgvector
    macOS (brew)  : brew install pgvector
    Docker        : use pgvector/pgvector:pg15 image

Index
-----
  An IVFFlat approximate-nearest-neighbour index is created on the
  embedding column with cosine distance.  For small datasets (<100 k rows)
  a brute-force scan (no index) is equally fast; the index becomes
  beneficial above ~50 k rows.

  The index is created CONCURRENTLY so it does not block writes during
  migration.  ``lists=100`` is appropriate for datasets up to ~1 M rows;
  tune upward for larger corpora.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0006_chunk_embeddings"
down_revision: Union[str, None] = "0005_audit_logs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()

    # pgvector extension — only needed on PostgreSQL.
    if bind.dialect.name == "postgresql":
        op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    op.create_table(
        "chunk_embeddings",
        sa.Column("id",           sa.String(36),               nullable=False),
        sa.Column("chunk_id",     sa.String(36),               nullable=False),
        sa.Column("document_id",  sa.String(36),               nullable=False),
        sa.Column("workspace_id", sa.String(36),               nullable=False),
        sa.Column("point_id",     sa.String(36),               nullable=False),
        # VECTOR(384) on PostgreSQL; TEXT on SQLite (used in tests).
        sa.Column(
            "embedding",
            sa.Text() if bind.dialect.name != "postgresql"
            else sa.Text(),   # overridden below for pg
            nullable=False,
        ),
        sa.Column("created_at",   sa.DateTime(timezone=True),  nullable=False),

        sa.ForeignKeyConstraint(["chunk_id"],     ["chunks.id"],     ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["document_id"],  ["documents.id"],  ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )

    # Unique constraint: one embedding per chunk.
    op.create_index(
        "ix_chunk_embeddings_chunk_id",
        "chunk_embeddings", ["chunk_id"],
        unique=True,
    )
    op.create_index("ix_chunk_embeddings_document_id",  "chunk_embeddings", ["document_id"])
    op.create_index("ix_chunk_embeddings_workspace_id", "chunk_embeddings", ["workspace_id"])
    op.create_index("ix_chunk_embeddings_point_id",     "chunk_embeddings", ["point_id"])

    # On PostgreSQL: change the embedding column to the proper VECTOR(384) type
    # and build the IVFFlat ANN index.
    if bind.dialect.name == "postgresql":
        op.execute(
            "ALTER TABLE chunk_embeddings "
            "ALTER COLUMN embedding TYPE vector(384) "
            "USING embedding::vector(384)"
        )
        # IVFFlat approximate nearest-neighbour index (cosine distance).
        # CREATE INDEX CONCURRENTLY cannot run inside a transaction block;
        # we close the implicit transaction first.
        op.execute("COMMIT")
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS "
            "ix_chunk_embeddings_embedding_cosine "
            "ON chunk_embeddings "
            "USING ivfflat (embedding vector_cosine_ops) "
            "WITH (lists = 100)"
        )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS "
            "ix_chunk_embeddings_embedding_cosine"
        )

    op.drop_index("ix_chunk_embeddings_point_id",     table_name="chunk_embeddings")
    op.drop_index("ix_chunk_embeddings_workspace_id", table_name="chunk_embeddings")
    op.drop_index("ix_chunk_embeddings_document_id",  table_name="chunk_embeddings")
    op.drop_index("ix_chunk_embeddings_chunk_id",     table_name="chunk_embeddings")
    op.drop_table("chunk_embeddings")
