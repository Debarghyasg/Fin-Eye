"""
Anomaly detection — Phase 3 Week 6 Day 1-3.

When a new financial document is processed for a ticker, this service:

  1. Extracts numeric metrics from the new document via the financial.comparison
     extractor (GPT-4o primary, Groq fallback).
  2. Persists each metric value to `metric_history` (one row per metric).
  3. Pulls historical values for the same (workspace_id, ticker, metric_name)
     tuple, EXCLUDING the current document.
  4. Computes mean + sample-population standard deviation across history.
  5. For each metric where |z| > 2.0 (where z = (current - mean) / stdev),
     writes a row to the `alerts` table classifying severity:
       |z| > 3.0  → high
       |z| > 2.5  → medium
       |z| > 2.0  → low
  6. Returns the list of newly-created Alert ORM objects.

Designed to be called from the document-indexing pipeline once a doc reaches
status=INDEXED. Safe to re-run: metric_history has a UNIQUE(document_id, metric_name)
constraint and existing rows are upserted.
"""
from __future__ import annotations

import logging
import statistics
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

log = logging.getLogger(__name__)

# Z-score threshold above which we raise an alert
Z_SCORE_THRESHOLD: float = 2.0

# Minimum number of historical samples required before we run detection.
# With <3 samples, mean/stdev are unreliable and we'd false-positive everything.
MIN_HISTORY_SAMPLES: int = 3

# Numeric metric paths we monitor — must match keys in MetricHistory.metric_name.
# Mirrors NUMERIC_METRIC_PATHS in services/financial/comparison.py.
MONITORED_METRICS: list[tuple[str, list[str]]] = [
    ("revenue", ["revenue", "value"]),
    ("net_income", ["net_income", "value"]),
    ("eps_diluted", ["earnings_per_share", "diluted_eps"]),
    ("gross_margin", ["gross_margin", "percentage"]),
    ("operating_expenses", ["operating_expenses", "total"]),
    ("rd_expenses", ["operating_expenses", "rd_expenses"]),
    ("sales_marketing", ["operating_expenses", "sales_marketing"]),
    ("general_admin", ["operating_expenses", "general_admin"]),
]


# ── Helpers ───────────────────────────────────────────────────────────────────
def _walk(metrics: dict, path: list[str]) -> Any:
    cur: Any = metrics
    for key in path:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(key)
        if cur is None:
            return None
    return cur


def _to_float(val: Any) -> Optional[float]:
    if val is None:
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def _severity_for_z(z: float) -> str:
    abs_z = abs(z)
    if abs_z > 3.0:
        return "high"
    if abs_z > 2.5:
        return "medium"
    return "low"


def compute_z_score(current: float, history: list[float]) -> Optional[dict[str, Any]]:
    """
    Pure helper — also useful in tests.

    Returns None if the sample is too small or stdev is zero.
    """
    if len(history) < MIN_HISTORY_SAMPLES:
        return None
    mean = statistics.mean(history)
    stdev = statistics.pstdev(history)
    if stdev == 0.0:
        return None
    z = (current - mean) / stdev
    return {
        "z_score": z,
        "mean": mean,
        "stdev": stdev,
        "sample_size": len(history),
        "is_anomaly": abs(z) > Z_SCORE_THRESHOLD,
        "severity": _severity_for_z(z) if abs(z) > Z_SCORE_THRESHOLD else None,
    }


# ── Persistence helpers ───────────────────────────────────────────────────────
async def _upsert_metric_history(
    db: AsyncSession,
    *,
    workspace_id: str,
    document_id: str,
    ticker: str,
    metric_name: str,
    metric_value: float,
    fiscal_period: Optional[str],
) -> None:
    """Insert or update a single (document, metric) row in metric_history."""
    from app.db.models import MetricHistory

    existing = await db.execute(
        select(MetricHistory).where(
            MetricHistory.document_id == document_id,
            MetricHistory.metric_name == metric_name,
        )
    )
    row = existing.scalar_one_or_none()
    if row is not None:
        row.metric_value = metric_value
        row.fiscal_period = fiscal_period
        return

    db.add(MetricHistory(
        workspace_id=workspace_id,
        document_id=document_id,
        ticker=ticker,
        metric_name=metric_name,
        metric_value=metric_value,
        fiscal_period=fiscal_period,
    ))


async def _fetch_history(
    db: AsyncSession,
    *,
    workspace_id: str,
    ticker: str,
    metric_name: str,
    exclude_document_id: str,
) -> list[float]:
    """Fetch historical metric values, excluding the current document."""
    from app.db.models import MetricHistory

    result = await db.execute(
        select(MetricHistory.metric_value).where(
            MetricHistory.workspace_id == workspace_id,
            MetricHistory.ticker == ticker,
            MetricHistory.metric_name == metric_name,
            MetricHistory.document_id != exclude_document_id,
        )
    )
    return [float(v) for (v,) in result.all() if v is not None]


def _build_alert_payload(
    *,
    metric_name: str,
    current_value: float,
    z_result: dict,
    ticker: str,
    period: Optional[str],
) -> dict[str, Any]:
    """Build the title + description for an anomaly alert."""
    direction_word = "above" if z_result["z_score"] > 0 else "below"
    metric_label = metric_name.replace("_", " ").title()
    period_str = f" in {period}" if period else ""

    title = f"{metric_label} Anomaly — {ticker}"

    description = (
        f"{metric_label} for {ticker}{period_str} ({current_value:,.2f}) is "
        f"{abs(z_result['z_score']):.2f}σ {direction_word} the historical mean "
        f"({z_result['mean']:,.2f}, σ={z_result['stdev']:,.2f}, "
        f"n={z_result['sample_size']}). This deviation exceeds the 2σ threshold "
        f"and may warrant analyst review."
    )

    return {
        "title": title,
        "description": description,
        "severity": z_result["severity"] or "low",
    }


# ── Public entry point ────────────────────────────────────────────────────────
async def run_anomaly_detection(
    document_id: str,
    db: AsyncSession,
    *,
    pre_extracted_metrics: Optional[dict] = None,
) -> list[Any]:
    """
    Run anomaly detection on a freshly indexed document.

    Args:
        document_id: ID of the newly processed document.
        db: Active async session — caller is responsible for committing.
        pre_extracted_metrics: Optional. If the comparison pipeline already
            extracted metrics, pass them here to skip a redundant LLM call.

    Returns:
        list[Alert] — the alerts written to the DB (may be empty).

    The caller MUST commit the session afterward. We do not commit here so
    this can run inside a larger transaction (e.g. the document-indexing pipeline).
    """
    from app.db.models import Alert, Chunk, Document
    from app.services.financial.comparison import extract_financial_metrics

    doc = (await db.execute(
        select(Document).where(Document.id == document_id)
    )).scalar_one_or_none()
    if doc is None:
        log.error("Anomaly detection: document %s not found", document_id)
        return []

    if not doc.ticker:
        log.info("Anomaly detection: document %s has no ticker — skipping", document_id)
        return []

    # 1. Acquire metrics — either from caller or by extracting now
    if pre_extracted_metrics is not None:
        metrics = pre_extracted_metrics
    else:
        chunks = (await db.execute(
            select(Chunk).where(Chunk.document_id == document_id).order_by(Chunk.chunk_index)
        )).scalars().all()
        if not chunks:
            log.warning("Anomaly detection: no chunks for document %s", document_id)
            return []
        content = "\n\n".join(c.text for c in chunks)
        metadata = {
            "doc_type": doc.doc_type,
            "company_name": doc.company_name,
            "fiscal_period": doc.fiscal_period,
            "ticker": doc.ticker,
        }
        metrics = await extract_financial_metrics(content, metadata)

    if "error" in metrics:
        log.warning("Anomaly detection: extraction failed for %s: %s", document_id, metrics["error"])
        return []

    alerts_created: list[Any] = []

    for metric_name, path in MONITORED_METRICS:
        current = _to_float(_walk(metrics, path))
        if current is None:
            continue

        # Persist current value to history (so future detections see it)
        await _upsert_metric_history(
            db,
            workspace_id=doc.workspace_id,
            document_id=doc.id,
            ticker=doc.ticker,
            metric_name=metric_name,
            metric_value=current,
            fiscal_period=doc.fiscal_period,
        )

        # Fetch history (excluding this doc) and Z-score
        history = await _fetch_history(
            db,
            workspace_id=doc.workspace_id,
            ticker=doc.ticker,
            metric_name=metric_name,
            exclude_document_id=doc.id,
        )

        z_result = compute_z_score(current, history)
        if z_result is None or not z_result["is_anomaly"]:
            continue

        payload = _build_alert_payload(
            metric_name=metric_name,
            current_value=current,
            z_result=z_result,
            ticker=doc.ticker,
            period=doc.fiscal_period,
        )

        alert = Alert(
            workspace_id=doc.workspace_id,
            user_id=doc.uploaded_by_id,
            document_id=doc.id,
            ticker=doc.ticker,
            alert_type="anomaly",
            severity=payload["severity"],
            title=payload["title"],
            description=payload["description"],
            metric_name=metric_name,
            metric_value=current,
            z_score=z_result["z_score"],
            historical_mean=z_result["mean"],
            historical_stdev=z_result["stdev"],
            sample_size=z_result["sample_size"],
        )
        db.add(alert)
        alerts_created.append(alert)

        log.info(
            "Anomaly detected: ticker=%s metric=%s value=%.2f z=%.2f severity=%s",
            doc.ticker, metric_name, current, z_result["z_score"], payload["severity"],
        )

    log.info(
        "Anomaly detection complete for %s: %d alerts created",
        document_id, len(alerts_created),
    )
    return alerts_created
