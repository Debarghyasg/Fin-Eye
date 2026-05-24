"""
Document comparison service — Week 4 stub.

Week 4 implementation plan:
  1. Pull all chunks for doc_a and doc_b from DB
  2. Use GPT-4o to extract structured financial metrics from each document:
       {revenue, net_income, gross_margin, r_and_d, operating_cash_flow, eps, ...}
  3. Compute metric deltas (absolute + percentage)
  4. Semantic diff of risk factor sections:
       - Embed each risk factor paragraph
       - Cluster and match similar paragraphs across documents
       - Classify as: new / expanded / removed / modified
  5. Sentiment analysis of management commentary:
       - Score each document's MD&A section with a finance-tuned sentiment model
       - Return { score_a, score_b, delta, interpretation }
  6. Generate AI narrative (GPT-4o) summarising the three sections above
"""
from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession
    from app.db.schemas import ComparisonRequest


async def compare_documents(
    request: "ComparisonRequest",
    db: "AsyncSession",
) -> dict:
    """
    Run a full AI comparison between two documents.

    Returns a dict matching the ComparisonResponse schema (defined in Week 4).

    STUB — raises NotImplementedError until Week 4.
    """
    raise NotImplementedError("Document comparison not implemented yet — Week 4.")
