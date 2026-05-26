"""add alerts, metric_history, and ticker_subscriptions

Revision ID: 0004_alerts_and_subs
Revises: 0003_financial_intelligence
Create Date: 2026-05-26 12:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0004_alerts_and_subs"
down_revision: Union[str, None] = "0003_financial_intelligence"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── metric_history ────────────────────────────────────────────────────────
    op.create_table(
        "metric_history",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("document_id", sa.String(length=36), nullable=False),
        sa.Column("ticker", sa.String(length=20), nullable=False),
        sa.Column("metric_name", sa.String(length=64), nullable=False),
        sa.Column("metric_value", sa.Float(), nullable=False),
        sa.Column("fiscal_period", sa.String(length=20), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("document_id", "metric_name", name="uq_metric_history_doc_metric"),
    )
    op.create_index("ix_metric_history_workspace_id", "metric_history", ["workspace_id"])
    op.create_index("ix_metric_history_document_id", "metric_history", ["document_id"])
    op.create_index("ix_metric_history_ticker", "metric_history", ["ticker"])
    op.create_index("ix_metric_history_metric_name", "metric_history", ["metric_name"])
    op.create_index("ix_metric_history_created_at", "metric_history", ["created_at"])
    # Composite for fast historical lookup
    op.create_index(
        "ix_metric_history_lookup",
        "metric_history",
        ["workspace_id", "ticker", "metric_name"],
    )

    # ── alerts ────────────────────────────────────────────────────────────────
    op.create_table(
        "alerts",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=True),
        sa.Column("document_id", sa.String(length=36), nullable=True),
        sa.Column("ticker", sa.String(length=20), nullable=True),
        sa.Column("alert_type", sa.String(length=32), nullable=False),
        sa.Column("severity", sa.String(length=16), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("metric_name", sa.String(length=64), nullable=True),
        sa.Column("metric_value", sa.Float(), nullable=True),
        sa.Column("z_score", sa.Float(), nullable=True),
        sa.Column("historical_mean", sa.Float(), nullable=True),
        sa.Column("historical_stdev", sa.Float(), nullable=True),
        sa.Column("sample_size", sa.Integer(), nullable=True),
        sa.Column("read", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("email_sent", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_alerts_workspace_id", "alerts", ["workspace_id"])
    op.create_index("ix_alerts_user_id", "alerts", ["user_id"])
    op.create_index("ix_alerts_document_id", "alerts", ["document_id"])
    op.create_index("ix_alerts_ticker", "alerts", ["ticker"])
    op.create_index("ix_alerts_alert_type", "alerts", ["alert_type"])
    op.create_index("ix_alerts_severity", "alerts", ["severity"])
    op.create_index("ix_alerts_read", "alerts", ["read"])
    op.create_index("ix_alerts_created_at", "alerts", ["created_at"])

    # ── ticker_subscriptions ──────────────────────────────────────────────────
    op.create_table(
        "ticker_subscriptions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("ticker", sa.String(length=20), nullable=False),
        sa.Column("company_name", sa.String(length=255), nullable=True),
        sa.Column("subscribe_anomaly", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("subscribe_sentiment", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("subscribe_filing", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("subscribe_regulatory", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("email_notifications", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("last_edgar_check_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_edgar_filing_url", sa.String(length=1024), nullable=True),
        sa.Column("last_edgar_accession", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "ticker", name="uq_ticker_sub_user_ticker"),
    )
    op.create_index("ix_ticker_subscriptions_user_id", "ticker_subscriptions", ["user_id"])
    op.create_index("ix_ticker_subscriptions_workspace_id", "ticker_subscriptions", ["workspace_id"])
    op.create_index("ix_ticker_subscriptions_ticker", "ticker_subscriptions", ["ticker"])
    op.create_index("ix_ticker_subscriptions_active", "ticker_subscriptions", ["active"])


def downgrade() -> None:
    op.drop_table("ticker_subscriptions")
    op.drop_table("alerts")
    op.drop_table("metric_history")
