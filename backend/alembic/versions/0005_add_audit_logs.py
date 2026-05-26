"""add audit_logs table (SEC Rule 17a-4 append-only audit trail)

Revision ID: 0005_audit_logs
Revises: 0004_alerts_and_subs
Create Date: 2026-05-26 14:00:00.000000

Creates the platform-wide audit trail required by the project spec
(PDF §10 — SEC Rule 17a-4 retention).

Schema notes
------------
* Indexes are designed to mirror DynamoDB access patterns:
    partition key  → workspace_id
    sort key       → created_at
    GSI            → user_id
  The composite (workspace_id, created_at DESC) supports the most common
  query: "show me everything that happened in this workspace, newest first".

* Append-only enforcement is implemented as a BEFORE UPDATE trigger on
  PostgreSQL only. Tests use SQLite via ``Base.metadata.create_all`` and
  therefore skip migrations entirely; the dialect guard below keeps this
  migration runnable on both backends if it is ever exercised.

* DELETE is intentionally NOT blocked — the Phase-5 retention job needs to
  purge rows past their ``expires_at`` timestamp.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0005_audit_logs"
down_revision: Union[str, None] = "0004_alerts_and_subs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# ── PostgreSQL trigger DDL — append-only enforcement ──────────────────────────
_CREATE_TRIGGER_FN_SQL = """
CREATE OR REPLACE FUNCTION audit_logs_no_update()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION
        'audit_logs is immutable (SEC 17a-4): UPDATE is not permitted. '
        'To purge expired records use DELETE.';
END;
$$ LANGUAGE plpgsql;
"""

_CREATE_TRIGGER_SQL = """
CREATE TRIGGER trg_audit_logs_no_update
    BEFORE UPDATE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION audit_logs_no_update();
"""

_DROP_TRIGGER_SQL = "DROP TRIGGER IF EXISTS trg_audit_logs_no_update ON audit_logs;"
_DROP_TRIGGER_FN_SQL = "DROP FUNCTION IF EXISTS audit_logs_no_update();"


def upgrade() -> None:
    op.create_table(
        "audit_logs",
        sa.Column("id", sa.String(length=36), nullable=False),

        # Tenancy / actor
        sa.Column("workspace_id", sa.String(length=36), nullable=True),
        sa.Column("user_id", sa.String(length=36), nullable=True),

        # What happened
        sa.Column("action", sa.String(length=50), nullable=False),
        sa.Column("resource_type", sa.String(length=50), nullable=False),
        sa.Column("resource_id", sa.String(length=36), nullable=True),

        # Request context
        sa.Column("ip_address", sa.String(length=45), nullable=True),
        sa.Column("user_agent", sa.Text(), nullable=True),
        sa.Column("request_id", sa.String(length=64), nullable=True),
        sa.Column("status_code", sa.Integer(), nullable=True),

        # Free-form JSON detail (JSONB on Postgres, JSON elsewhere)
        sa.Column("metadata", sa.JSON(), nullable=True),

        # Time
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),

        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )

    # ── Indexes — mirror DynamoDB access patterns ────────────────────────────
    op.create_index("ix_audit_logs_workspace_id", "audit_logs", ["workspace_id"])
    op.create_index("ix_audit_logs_user_id",      "audit_logs", ["user_id"])
    op.create_index("ix_audit_logs_action",       "audit_logs", ["action"])
    op.create_index("ix_audit_logs_request_id",   "audit_logs", ["request_id"])
    op.create_index("ix_audit_logs_created_at",   "audit_logs", ["created_at"])
    # Composite index for the most common query: workspace-scoped, newest-first.
    op.create_index(
        "ix_audit_logs_workspace_time",
        "audit_logs",
        ["workspace_id", sa.text("created_at DESC")],
    )
    # Composite index for user-scoped audit (mirrors a DynamoDB GSI).
    op.create_index(
        "ix_audit_logs_user_time",
        "audit_logs",
        ["user_id", sa.text("created_at DESC")],
    )

    # ── Append-only enforcement (PostgreSQL only) ─────────────────────────────
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute(_CREATE_TRIGGER_FN_SQL)
        op.execute(_CREATE_TRIGGER_SQL)


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute(_DROP_TRIGGER_SQL)
        op.execute(_DROP_TRIGGER_FN_SQL)

    op.drop_index("ix_audit_logs_user_time",      table_name="audit_logs")
    op.drop_index("ix_audit_logs_workspace_time", table_name="audit_logs")
    op.drop_index("ix_audit_logs_created_at",     table_name="audit_logs")
    op.drop_index("ix_audit_logs_request_id",     table_name="audit_logs")
    op.drop_index("ix_audit_logs_action",         table_name="audit_logs")
    op.drop_index("ix_audit_logs_user_id",        table_name="audit_logs")
    op.drop_index("ix_audit_logs_workspace_id",   table_name="audit_logs")

    op.drop_table("audit_logs")
