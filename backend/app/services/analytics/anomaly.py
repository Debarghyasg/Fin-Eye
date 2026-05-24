"""
Anomaly detection service — Week 4 stub.

Week 4 implementation plan:
  1. For each newly indexed document, extract key financial metrics
  2. Fetch historical values for the same ticker from previous documents
  3. Compute z-scores:  z = (current - mean) / std_dev
  4. Flag metrics where |z| > 2.0 as anomalies
  5. Also run sentiment analysis on management commentary:
       - Compare sentiment score to trailing 4-quarter average
       - Flag shifts > 0.15 points
  6. Scan regulatory/risk sections for new legal entity names, new
     regulatory keywords not present in prior filings
  7. Persist anomalies to an alerts table (Week 4 migration)
  8. Enqueue email/Slack/PagerDuty notifications via SQS
"""
from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


async def run_anomaly_detection(
    document_id: str,
    db: "AsyncSession",
) -> list[dict]:
    """
    Run anomaly detection on a freshly indexed document.

    Returns a list of alert dicts (empty list → no anomalies found).

    STUB — raises NotImplementedError until Week 4.
    """
    raise NotImplementedError("Anomaly detection not implemented yet — Week 4.")
