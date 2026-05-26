"""
Document comparison routes — Phase 3 Week 5 Day 6-7.

POST /api/v1/comparisons         — kick off a new comparison (background task)
GET  /api/v1/comparisons         — list user's comparison history
GET  /api/v1/comparisons/{id}    — fetch a comparison's status + results

The heavy lifting (extraction, sentiment, narrative) runs in a background task
so the POST request returns immediately. The worker is exposed as
`run_comparison_pipeline()` so tests can invoke it inline.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, get_db
from app.db.models import Document, DocumentComparison, User, Workspace
from app.db.schemas import (
    DocumentComparisonListItem,
    DocumentComparisonRequest,
    DocumentComparisonResult,
    FinancialMetricComparison,
)
from app.db.session import AsyncSessionLocal

log = logging.getLogger(__name__)
router = APIRouter(prefix="/comparisons", tags=["financial-intelligence"])


# ── Helpers ───────────────────────────────────────────────────────────────────
def _diff_to_metric_list(diff: dict) -> list[FinancialMetricComparison]:
    """Convert dict-form metric_comparisons → list of FinancialMetricComparison."""
    out: list[FinancialMetricComparison] = []
    for name, item in (diff.get("metric_comparisons") or {}).items():
        if not item:
            continue
        out.append(FinancialMetricComparison(
            metric_name=name,
            old_value=item.get("old_value"),
            new_value=item.get("new_value"),
            absolute_change=item.get("absolute_change"),
            percentage_change=item.get("percentage_change"),
            direction=item.get("direction", "flat"),
            significance=item.get("significance", "unknown"),
        ))
    return out


def _document_payload(doc: Optional[Document], fallback_id: str) -> dict:
    if doc is None:
        return {
            "id": fallback_id,
            "filename": "unknown",
            "company": None,
            "ticker": None,
            "period": None,
            "doc_type": None,
        }
    return {
        "id": doc.id,
        "filename": doc.original_filename,
        "company": doc.company_name,
        "ticker": doc.ticker,
        "period": doc.fiscal_period,
        "doc_type": doc.doc_type,
    }


def _classify_sentiment_shift(sentiment_shift: dict | None) -> str | None:
    """Map sentiment_shift.direction → 'positive' | 'negative' | 'stable'."""
    if not sentiment_shift:
        return None
    sig = sentiment_shift.get("significance")
    direction = sentiment_shift.get("direction")
    if sig in ("negligible", None):
        return "stable"
    if direction == "more_positive":
        return "positive"
    if direction == "more_negative":
        return "negative"
    return "stable"


# ── Worker (called by BackgroundTasks AND by tests) ───────────────────────────
async def run_comparison_pipeline(
    comparison_id: str,
    include_sentiment: bool,
    include_narrative: bool,
    db: Optional[AsyncSession] = None,
) -> None:
    """
    Run the full comparison pipeline for a DocumentComparison row.

    If `db` is provided, uses the caller's session (test path).
    If `db` is None, opens a fresh session via AsyncSessionLocal (production path).
    """
    from app.services.financial.comparison import compare_documents, generate_narrative_summary
    from app.services.financial.sentiment import analyze_document_sentiment, compare_sentiment_periods

    own_session = db is None
    session: AsyncSession = db if db is not None else AsyncSessionLocal()
    started = time.perf_counter()

    try:
        # Load the comparison row
        result = await session.execute(
            select(DocumentComparison).where(DocumentComparison.id == comparison_id)
        )
        comparison = result.scalar_one_or_none()
        if comparison is None:
            log.error("Comparison %s not found in worker", comparison_id)
            return

        # 1. Compare documents (extraction + diff)
        comp_payload = await compare_documents(
            comparison.document_a_id,
            comparison.document_b_id,
            session,
        )
        diff = comp_payload["diff"]
        documents = comp_payload["documents"]

        # 2. Sentiment analysis (optional, runs in parallel for both docs)
        sentiment_comp: dict | None = None
        if include_sentiment:
            try:
                from app.db.models import Chunk

                # Aggregate chunk text again for sentiment (small overhead, keeps services decoupled)
                chunks_a = (await session.execute(
                    select(Chunk).where(Chunk.document_id == comparison.document_a_id)
                    .order_by(Chunk.chunk_index)
                )).scalars().all()
                chunks_b = (await session.execute(
                    select(Chunk).where(Chunk.document_id == comparison.document_b_id)
                    .order_by(Chunk.chunk_index)
                )).scalars().all()
                content_a = "\n\n".join(c.text for c in chunks_a)
                content_b = "\n\n".join(c.text for c in chunks_b)

                meta_a = {"doc_type": documents["document_a"].get("doc_type")}
                meta_b = {"doc_type": documents["document_b"].get("doc_type")}

                sentiment_a, sentiment_b = await asyncio.gather(
                    analyze_document_sentiment(content_a, meta_a),
                    analyze_document_sentiment(content_b, meta_b),
                )
                sentiment_comp = compare_sentiment_periods(sentiment_a, sentiment_b)
            except Exception as exc:
                log.warning("Sentiment analysis failed for comparison %s: %s", comparison_id, exc)
                sentiment_comp = {"error": str(exc)}

        # 3. Narrative summary (optional)
        narrative: str | None = None
        if include_narrative:
            try:
                narrative = await generate_narrative_summary(diff, documents, sentiment_comp)
            except Exception as exc:
                log.warning("Narrative generation failed for comparison %s: %s", comparison_id, exc)

        # 4. Persist results
        comparison.financial_metrics_comparison = json.dumps(diff, default=str)
        comparison.sentiment_comparison = json.dumps(sentiment_comp, default=str) if sentiment_comp else None
        comparison.narrative_summary = narrative
        comparison.total_metrics_compared = (diff.get("summary") or {}).get("total_metrics_compared", 0)
        comparison.metrics_with_significant_changes = len(
            (diff.get("summary") or {}).get("significant_changes", [])
        )
        comparison.overall_sentiment_shift = _classify_sentiment_shift(
            (sentiment_comp or {}).get("sentiment_shift") if sentiment_comp else None
        )
        comparison.status = "completed"
        comparison.processing_time_ms = int((time.perf_counter() - started) * 1000)

        await session.commit()
        log.info("Comparison %s completed in %dms", comparison_id, comparison.processing_time_ms)

    except Exception as exc:
        log.exception("Comparison pipeline failed for %s: %s", comparison_id, exc)
        try:
            comparison.status = "failed"
            comparison.error_message = str(exc)
            comparison.processing_time_ms = int((time.perf_counter() - started) * 1000)
            await session.commit()
        except Exception as commit_exc:
            log.error("Failed to mark comparison failed: %s", commit_exc)
            await session.rollback()

    finally:
        if own_session:
            await session.close()


# ── POST /comparisons ─────────────────────────────────────────────────────────
@router.post(
    "",
    response_model=DocumentComparisonResult,
    status_code=status.HTTP_201_CREATED,
    summary="Compare two financial documents",
)
async def create_comparison(
    body: DocumentComparisonRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DocumentComparisonResult:
    """
    Kick off a comparison between two documents owned by the current user.

    Returns immediately with status='processing'. Poll GET /comparisons/{id}
    or check the comparison list to see when it completes.
    """
    if body.document_a_id == body.document_b_id:
        raise HTTPException(400, "Cannot compare a document with itself.")

    # Validate both docs exist and belong to a workspace owned by current user
    docs_result = await db.execute(
        select(Document)
        .join(Workspace, Document.workspace_id == Workspace.id)
        .where(
            Document.id.in_([body.document_a_id, body.document_b_id]),
            Workspace.owner_id == current_user.id,
        )
    )
    docs_by_id = {d.id: d for d in docs_result.scalars().all()}

    doc_a = docs_by_id.get(body.document_a_id)
    doc_b = docs_by_id.get(body.document_b_id)
    if doc_a is None:
        raise HTTPException(404, f"Document {body.document_a_id} not found or access denied")
    if doc_b is None:
        raise HTTPException(404, f"Document {body.document_b_id} not found or access denied")

    if doc_a.ticker and doc_b.ticker and doc_a.ticker != doc_b.ticker:
        log.info("Cross-company comparison: %s vs %s", doc_a.ticker, doc_b.ticker)

    # Create the comparison row
    comparison = DocumentComparison(
        workspace_id=doc_a.workspace_id,
        user_id=current_user.id,
        document_a_id=body.document_a_id,
        document_b_id=body.document_b_id,
        status="processing",
        total_metrics_compared=0,
        metrics_with_significant_changes=0,
    )
    db.add(comparison)
    await db.commit()
    await db.refresh(comparison)

    # Schedule the worker (uses fresh session so it survives request teardown)
    background_tasks.add_task(
        run_comparison_pipeline,
        comparison.id,
        body.include_sentiment,
        body.include_narrative,
    )

    log.info(
        "Started comparison %s: %s (%s) vs %s (%s)",
        comparison.id, doc_a.id, doc_a.fiscal_period, doc_b.id, doc_b.fiscal_period,
    )

    return DocumentComparisonResult(
        comparison_id=comparison.id,
        status="processing",
        documents={
            "document_a": _document_payload(doc_a, doc_a.id),
            "document_b": _document_payload(doc_b, doc_b.id),
        },
        financial_metrics=[],
        risk_factor_changes=None,
        guidance_change=None,
        sentiment_analysis=None,
        narrative_summary=None,
        summary_statistics={"status": "processing"},
        processing_time_ms=None,
        error_message=None,
        created_at=comparison.created_at,
    )


# ── GET /comparisons/{id} ─────────────────────────────────────────────────────
@router.get(
    "/{comparison_id}",
    response_model=DocumentComparisonResult,
    summary="Get a comparison's status + results",
)
async def get_comparison(
    comparison_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DocumentComparisonResult:
    result = await db.execute(
        select(DocumentComparison)
        .join(Workspace, DocumentComparison.workspace_id == Workspace.id)
        .where(
            DocumentComparison.id == comparison_id,
            Workspace.owner_id == current_user.id,
        )
    )
    comparison = result.scalar_one_or_none()
    if comparison is None:
        raise HTTPException(404, "Comparison not found or access denied")

    docs_result = await db.execute(
        select(Document).where(
            Document.id.in_([comparison.document_a_id, comparison.document_b_id])
        )
    )
    docs_by_id = {d.id: d for d in docs_result.scalars().all()}

    diff: dict = {}
    if comparison.financial_metrics_comparison:
        try:
            diff = json.loads(comparison.financial_metrics_comparison)
        except json.JSONDecodeError:
            log.error("Bad JSON in comparison %s metrics", comparison_id)

    sentiment: dict | None = None
    if comparison.sentiment_comparison:
        try:
            sentiment = json.loads(comparison.sentiment_comparison)
        except json.JSONDecodeError:
            sentiment = None

    return DocumentComparisonResult(
        comparison_id=comparison.id,
        status=comparison.status,
        documents={
            "document_a": _document_payload(docs_by_id.get(comparison.document_a_id), comparison.document_a_id),
            "document_b": _document_payload(docs_by_id.get(comparison.document_b_id), comparison.document_b_id),
        },
        financial_metrics=_diff_to_metric_list(diff),
        risk_factor_changes=diff.get("risk_factor_changes"),
        guidance_change=diff.get("guidance_change"),
        sentiment_analysis=sentiment,
        narrative_summary=comparison.narrative_summary,
        summary_statistics={
            "total_metrics_compared": comparison.total_metrics_compared,
            "metrics_with_significant_changes": comparison.metrics_with_significant_changes,
            "overall_sentiment_shift": comparison.overall_sentiment_shift,
            **(diff.get("summary") or {}),
        },
        processing_time_ms=comparison.processing_time_ms,
        error_message=comparison.error_message,
        created_at=comparison.created_at,
    )


# ── GET /comparisons ──────────────────────────────────────────────────────────
@router.get(
    "",
    response_model=list[DocumentComparisonListItem],
    summary="List the current user's comparisons",
)
async def list_comparisons(
    workspace_id: Optional[str] = Query(None, description="Filter by workspace"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[DocumentComparisonListItem]:
    query = (
        select(DocumentComparison)
        .join(Workspace, DocumentComparison.workspace_id == Workspace.id)
        .where(Workspace.owner_id == current_user.id)
    )
    if workspace_id:
        query = query.where(DocumentComparison.workspace_id == workspace_id)
    query = query.order_by(DocumentComparison.created_at.desc()).offset(offset).limit(limit)

    rows = (await db.execute(query)).scalars().all()
    return [
        DocumentComparisonListItem(
            id=c.id,
            workspace_id=c.workspace_id,
            document_a_id=c.document_a_id,
            document_b_id=c.document_b_id,
            status=c.status,
            total_metrics_compared=c.total_metrics_compared,
            metrics_with_significant_changes=c.metrics_with_significant_changes,
            overall_sentiment_shift=c.overall_sentiment_shift,
            processing_time_ms=c.processing_time_ms,
            created_at=c.created_at,
        )
        for c in rows
    ]
