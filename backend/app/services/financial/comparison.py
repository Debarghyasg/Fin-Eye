"""
Document comparison service — Phase 3 Week 5 Day 1-3.

Extracts structured financial metrics from two documents using GPT-4o
and returns a diff with absolute changes, percentage changes, and direction.

Metrics extracted:
  - Revenue (with growth rate)
  - Net income
  - EPS (basic + diluted)
  - Gross margin
  - Operating expenses (R&D, S&M, G&A breakdown)
  - Key risk factors
  - Management guidance and outlook tone

Falls back to Groq Llama-3.1-70b if OPENAI_API_KEY is not configured.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings

log = logging.getLogger(__name__)


# ── Schema description (passed to the LLM) ────────────────────────────────────
EXTRACTION_SCHEMA: dict[str, Any] = {
    "revenue": {
        "value": "number — revenue in millions of base currency",
        "currency": "string — ISO currency code (USD/EUR/etc.)",
        "period": "string — reporting period e.g. 'FY2023', 'Q3 2024'",
        "growth_rate": "number — YoY growth as decimal (0.12 = 12%)",
        "context": "string — short note",
    },
    "net_income": {
        "value": "number — net income in millions",
        "currency": "string",
        "period": "string",
        "growth_rate": "number — decimal",
        "context": "string",
    },
    "earnings_per_share": {
        "basic_eps": "number",
        "diluted_eps": "number",
        "currency": "string",
        "period": "string",
        "growth_rate": "number — decimal",
        "context": "string",
    },
    "gross_margin": {
        "percentage": "number — gross margin as percentage (44.1 not 0.441)",
        "period": "string",
        "change_from_previous": "number — basis points change",
        "context": "string",
    },
    "operating_expenses": {
        "total": "number — total operating expenses in millions",
        "rd_expenses": "number — R&D expenses in millions",
        "sales_marketing": "number — S&M in millions",
        "general_admin": "number — G&A in millions",
        "currency": "string",
        "period": "string",
        "context": "string",
    },
    "key_risk_factors": [
        {
            "category": "string — risk category",
            "description": "string — short description",
            "severity": "string — one of: low/medium/high",
            "new_this_period": "boolean — true if newly added this period",
        }
    ],
    "management_guidance": {
        "revenue_guidance": "string",
        "earnings_guidance": "string",
        "key_initiatives": ["string"],
        "market_outlook": "string",
        "confidence_tone": "string — one of: very_positive/positive/neutral/cautious/negative",
    },
}


_EXTRACTION_SYSTEM_PROMPT = """You are a senior financial analyst extracting structured data from SEC filings, earnings releases, and annual reports.

Rules (follow strictly):
1. Extract values ONLY when explicitly stated in the document. Use null for anything missing.
2. Convert all monetary values to MILLIONS of the document's base currency (e.g. $1.2B → 1200, $383B → 383000).
3. Express decimals consistently:
   - growth_rate fields: decimal (12% → 0.12)
   - gross_margin.percentage: percent value (44.1 NOT 0.441)
4. Periods must match the document (e.g. "FY2023", "Q3 2024").
5. For key_risk_factors return at most 6 items, ranked by importance.
6. Return ONLY valid JSON matching the schema. No markdown, no commentary.
"""


def _build_extraction_user_prompt(content: str, metadata: dict[str, Any]) -> str:
    return (
        f"Document type: {metadata.get('doc_type') or 'unknown'}\n"
        f"Company: {metadata.get('company_name') or 'unknown'}\n"
        f"Ticker: {metadata.get('ticker') or 'unknown'}\n"
        f"Reporting period: {metadata.get('fiscal_period') or 'unknown'}\n\n"
        f"DOCUMENT CONTENT (truncated to 12k chars):\n"
        f"---\n{content[:12000]}\n---\n\n"
        f"Extract the following fields as JSON (use null for any missing):\n"
        f"{json.dumps(EXTRACTION_SCHEMA, indent=2)}"
    )


# ── Extraction (GPT-4o primary, Groq fallback) ────────────────────────────────
async def extract_financial_metrics(
    document_content: str,
    document_metadata: dict[str, Any],
) -> dict[str, Any]:
    """
    Extract structured financial metrics from raw document text.

    Tries GPT-4o first (if OPENAI_API_KEY set), then falls back to Groq Llama.
    Always returns a dict — never raises if at least one provider works.
    """
    if not document_content or not document_content.strip():
        return {"error": "empty document content"}

    user_prompt = _build_extraction_user_prompt(document_content, document_metadata)

    # Primary: GPT-4o
    if settings.OPENAI_API_KEY:
        try:
            return await _extract_openai(user_prompt, document_metadata)
        except Exception as exc:
            log.warning("GPT-4o extraction failed: %s — falling back to Groq", exc)

    # Fallback: Groq
    if settings.GROQ_API_KEY:
        try:
            return await _extract_groq(user_prompt, document_metadata)
        except Exception as exc:
            log.error("Groq extraction failed: %s", exc)
            return {"error": f"all providers failed: {exc}"}

    return {"error": "no LLM provider configured (set OPENAI_API_KEY or GROQ_API_KEY)"}


async def _extract_openai(user_prompt: str, metadata: dict[str, Any]) -> dict[str, Any]:
    from openai import AsyncOpenAI

    client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
    response = await client.chat.completions.create(
        model=settings.OPENAI_MODEL,
        temperature=0.1,
        max_tokens=2500,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": _EXTRACTION_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
    )
    raw = response.choices[0].message.content or "{}"
    metrics = json.loads(raw)
    metrics["_extraction_metadata"] = {
        "model_used": settings.OPENAI_MODEL,
        "provider": "openai",
        "company": metadata.get("company_name"),
        "period": metadata.get("fiscal_period"),
        "ticker": metadata.get("ticker"),
    }
    return metrics


async def _extract_groq(user_prompt: str, metadata: dict[str, Any]) -> dict[str, Any]:
    """Run Groq in a thread because the SDK is sync."""
    def _call() -> dict[str, Any]:
        from groq import Groq
        client = Groq(api_key=settings.GROQ_API_KEY)
        response = client.chat.completions.create(
            model=settings.GROQ_MODEL,
            temperature=0.1,
            max_tokens=2500,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": _EXTRACTION_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
        )
        raw = response.choices[0].message.content or "{}"
        # Strip markdown fences if present
        raw = raw.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        return json.loads(raw.strip())

    metrics = await asyncio.to_thread(_call)
    metrics["_extraction_metadata"] = {
        "model_used": settings.GROQ_MODEL,
        "provider": "groq",
        "company": metadata.get("company_name"),
        "period": metadata.get("fiscal_period"),
        "ticker": metadata.get("ticker"),
    }
    return metrics


# ── Diff helpers ──────────────────────────────────────────────────────────────
def _safe_float(val: Any) -> Optional[float]:
    """Coerce LLM output to float; return None for missing/invalid."""
    if val is None:
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def _direction(change: float) -> str:
    if change > 0:
        return "increase"
    if change < 0:
        return "decrease"
    return "flat"


def _significance(percent_change: Optional[float]) -> str:
    if percent_change is None:
        return "unknown"
    abs_change = abs(percent_change)
    if abs_change > 50:
        return "major"
    if abs_change > 20:
        return "moderate"
    if abs_change > 5:
        return "minor"
    return "negligible"


def calculate_change(
    old_value: Optional[float],
    new_value: Optional[float],
) -> Optional[dict[str, Any]]:
    """Return a diff dict for two numeric values (or None if not comparable)."""
    if old_value is None or new_value is None:
        return None
    if old_value == 0:
        # Avoid division by zero — use absolute change only
        return {
            "old_value": old_value,
            "new_value": new_value,
            "absolute_change": new_value - old_value,
            "percentage_change": None,
            "direction": _direction(new_value - old_value),
            "significance": "unknown",
        }
    abs_change = new_value - old_value
    pct_change = (abs_change / abs(old_value)) * 100.0
    return {
        "old_value": old_value,
        "new_value": new_value,
        "absolute_change": abs_change,
        "percentage_change": pct_change,
        "direction": _direction(abs_change),
        "significance": _significance(pct_change),
    }


def _extract_metric_value(metrics: dict[str, Any], path: list[str]) -> Optional[float]:
    """Walk a nested dict path, coerce to float."""
    cur: Any = metrics
    for key in path:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(key)
        if cur is None:
            return None
    return _safe_float(cur)


# Metrics we diff numerically
NUMERIC_METRIC_PATHS: list[tuple[str, list[str]]] = [
    ("revenue", ["revenue", "value"]),
    ("net_income", ["net_income", "value"]),
    ("eps_basic", ["earnings_per_share", "basic_eps"]),
    ("eps_diluted", ["earnings_per_share", "diluted_eps"]),
    ("gross_margin", ["gross_margin", "percentage"]),
    ("operating_expenses", ["operating_expenses", "total"]),
    ("rd_expenses", ["operating_expenses", "rd_expenses"]),
    ("sales_marketing", ["operating_expenses", "sales_marketing"]),
    ("general_admin", ["operating_expenses", "general_admin"]),
]


def diff_metrics(metrics_a: dict[str, Any], metrics_b: dict[str, Any]) -> dict[str, Any]:
    """
    Compute a structured diff between two extracted-metrics dicts.

    Returns:
        {
            "metric_comparisons": {metric_name: {old_value, new_value, ...}},
            "risk_factor_changes": {added: [...], removed: [...]},
            "guidance_change": {...},
            "summary": {total_metrics_compared, significant_changes, ...},
        }
    """
    metric_comparisons: dict[str, Optional[dict[str, Any]]] = {}
    significant_changes: list[dict[str, Any]] = []

    # Numeric metric diffs
    for name, path in NUMERIC_METRIC_PATHS:
        old_val = _extract_metric_value(metrics_a, path)
        new_val = _extract_metric_value(metrics_b, path)
        diff = calculate_change(old_val, new_val)
        metric_comparisons[name] = diff
        if diff and diff.get("percentage_change") is not None and abs(diff["percentage_change"]) > 10:
            significant_changes.append({
                "metric": name,
                "percentage_change": diff["percentage_change"],
                "direction": diff["direction"],
            })

    # Risk-factor diff (string-set comparison on category|description)
    risk_a = metrics_a.get("key_risk_factors") or []
    risk_b = metrics_b.get("key_risk_factors") or []

    def _risk_key(r: dict[str, Any]) -> str:
        return f"{r.get('category', '')}|{r.get('description', '')}".lower().strip()

    set_a = {_risk_key(r): r for r in risk_a if isinstance(r, dict)}
    set_b = {_risk_key(r): r for r in risk_b if isinstance(r, dict)}
    added = [set_b[k] for k in set_b.keys() - set_a.keys()]
    removed = [set_a[k] for k in set_a.keys() - set_b.keys()]
    risk_factor_changes = {
        "added": added,
        "removed": removed,
        "count_a": len(risk_a),
        "count_b": len(risk_b),
    }

    # Guidance / tone change
    tone_a = (metrics_a.get("management_guidance") or {}).get("confidence_tone")
    tone_b = (metrics_b.get("management_guidance") or {}).get("confidence_tone")
    guidance_change = {
        "tone_a": tone_a,
        "tone_b": tone_b,
        "shifted": tone_a is not None and tone_b is not None and tone_a != tone_b,
    }

    metrics_with_changes = sum(
        1 for d in metric_comparisons.values()
        if d and d.get("absolute_change") not in (None, 0)
    )

    return {
        "metric_comparisons": metric_comparisons,
        "risk_factor_changes": risk_factor_changes,
        "guidance_change": guidance_change,
        "summary": {
            "total_metrics_compared": sum(1 for d in metric_comparisons.values() if d),
            "metrics_with_changes": metrics_with_changes,
            "significant_changes": significant_changes,
            "new_risk_factors": len(added),
            "removed_risk_factors": len(removed),
        },
    }


# ── Public top-level entry point ──────────────────────────────────────────────
async def compare_documents(
    document_id_a: str,
    document_id_b: str,
    db: AsyncSession,
) -> dict[str, Any]:
    """
    Top-level comparison: fetch documents, extract metrics, diff, return.

    Does NOT include sentiment or narrative — those are computed separately
    by the route handler (see app/api/routes/comparisons.py).
    """
    from app.db.models import Chunk, Document

    # Fetch both documents
    doc_a = (await db.execute(select(Document).where(Document.id == document_id_a))).scalar_one_or_none()
    doc_b = (await db.execute(select(Document).where(Document.id == document_id_b))).scalar_one_or_none()
    if doc_a is None:
        raise ValueError(f"Document not found: {document_id_a}")
    if doc_b is None:
        raise ValueError(f"Document not found: {document_id_b}")

    # Aggregate chunk text in document order
    chunks_a = (await db.execute(
        select(Chunk).where(Chunk.document_id == document_id_a).order_by(Chunk.chunk_index)
    )).scalars().all()
    chunks_b = (await db.execute(
        select(Chunk).where(Chunk.document_id == document_id_b).order_by(Chunk.chunk_index)
    )).scalars().all()

    content_a = "\n\n".join(c.text for c in chunks_a)
    content_b = "\n\n".join(c.text for c in chunks_b)

    metadata_a = {
        "doc_type": doc_a.doc_type,
        "company_name": doc_a.company_name,
        "fiscal_period": doc_a.fiscal_period,
        "ticker": doc_a.ticker,
    }
    metadata_b = {
        "doc_type": doc_b.doc_type,
        "company_name": doc_b.company_name,
        "fiscal_period": doc_b.fiscal_period,
        "ticker": doc_b.ticker,
    }

    log.info(
        "Extracting metrics in parallel: a=%s (%s) b=%s (%s)",
        document_id_a, doc_a.fiscal_period, document_id_b, doc_b.fiscal_period,
    )

    metrics_a, metrics_b = await asyncio.gather(
        extract_financial_metrics(content_a, metadata_a),
        extract_financial_metrics(content_b, metadata_b),
    )

    diff = diff_metrics(metrics_a, metrics_b)

    return {
        "raw_metrics": {"a": metrics_a, "b": metrics_b},
        "diff": diff,
        "documents": {
            "document_a": {
                "id": doc_a.id,
                "filename": doc_a.original_filename,
                "company": doc_a.company_name,
                "ticker": doc_a.ticker,
                "period": doc_a.fiscal_period,
                "doc_type": doc_a.doc_type,
            },
            "document_b": {
                "id": doc_b.id,
                "filename": doc_b.original_filename,
                "company": doc_b.company_name,
                "ticker": doc_b.ticker,
                "period": doc_b.fiscal_period,
                "doc_type": doc_b.doc_type,
            },
        },
    }


# ── Narrative summary (LLM-generated) ─────────────────────────────────────────
_NARRATIVE_SYSTEM_PROMPT = """You are a senior equity analyst writing a brief executive summary of period-over-period financial changes.

Rules:
- 3-6 sentences total. Concise, factual, no fluff.
- Lead with the most material metric change.
- Cite exact numbers with units (e.g. "Revenue fell 2.8% to $383.3B").
- Mention the management tone shift if one occurred.
- If new risk factors appeared, note the most notable one.
- No bullet points, no headers, no markdown — flowing prose."""


async def generate_narrative_summary(
    diff: dict[str, Any],
    documents: dict[str, Any],
    sentiment_comparison: Optional[dict[str, Any]] = None,
) -> str:
    """Generate a 3-6 sentence narrative summary using the same LLM stack."""
    payload = {
        "doc_a": documents.get("document_a"),
        "doc_b": documents.get("document_b"),
        "metric_diff": diff.get("metric_comparisons", {}),
        "significant_changes": diff.get("summary", {}).get("significant_changes", []),
        "risk_changes": {
            "new": [r.get("description") for r in (diff.get("risk_factor_changes") or {}).get("added", [])][:3],
            "removed": [r.get("description") for r in (diff.get("risk_factor_changes") or {}).get("removed", [])][:3],
        },
        "guidance_shift": diff.get("guidance_change"),
        "sentiment_shift": (sentiment_comparison or {}).get("sentiment_shift"),
    }

    user_prompt = (
        "Write a brief executive summary based on this comparison data:\n\n"
        f"{json.dumps(payload, indent=2, default=str)}"
    )

    if settings.OPENAI_API_KEY:
        try:
            from openai import AsyncOpenAI
            client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
            response = await client.chat.completions.create(
                model=settings.OPENAI_MODEL,
                temperature=0.3,
                max_tokens=400,
                messages=[
                    {"role": "system", "content": _NARRATIVE_SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
            )
            return (response.choices[0].message.content or "").strip()
        except Exception as exc:
            log.warning("OpenAI narrative failed: %s — falling back to Groq", exc)

    if settings.GROQ_API_KEY:
        def _call() -> str:
            from groq import Groq
            client = Groq(api_key=settings.GROQ_API_KEY)
            response = client.chat.completions.create(
                model=settings.GROQ_MODEL,
                temperature=0.3,
                max_tokens=400,
                messages=[
                    {"role": "system", "content": _NARRATIVE_SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
            )
            return (response.choices[0].message.content or "").strip()
        try:
            return await asyncio.to_thread(_call)
        except Exception as exc:
            log.error("Groq narrative also failed: %s", exc)

    # Deterministic fallback if no LLM available
    return _heuristic_narrative(diff)


def _heuristic_narrative(diff: dict[str, Any]) -> str:
    """Plain-text fallback summary when no LLM is configured."""
    sig_changes = (diff.get("summary") or {}).get("significant_changes", [])
    if not sig_changes:
        return "Financial performance was broadly stable across the two reporting periods, with no metric changing by more than 10% in either direction."
    parts = []
    for ch in sig_changes[:3]:
        metric = (ch.get("metric") or "").replace("_", " ")
        pct = ch.get("percentage_change", 0.0)
        verb = "increased" if pct > 0 else "decreased"
        parts.append(f"{metric} {verb} by {abs(pct):.1f}%")
    body = "; ".join(parts)
    return f"Several material changes occurred between the two periods: {body}."
