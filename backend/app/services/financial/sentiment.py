"""
FinBERT sentiment analysis — Phase 3 Week 5 Day 4-5.

Runs ProsusAI/finbert (a BERT model fine-tuned on the Financial PhraseBank)
over management-commentary sections of earnings calls and SEC filings.

Returns positive/neutral/negative probabilities and detects period-over-period
sentiment shifts (e.g. 0.80 → 0.50 positive is a strong signal).

Model:
  - ProsusAI/finbert (~440 MB on first download, cached locally)
  - Runs on CPU, ~50 ms per 512-token chunk
  - Output order from HuggingFace: [positive, negative, neutral]

The model is loaded lazily on first call and cached in a module-level singleton.
All HuggingFace calls run in a thread pool to avoid blocking the event loop.
"""
from __future__ import annotations

import asyncio
import logging
import re
from typing import Any, Optional

log = logging.getLogger(__name__)

# Module-level singleton — loaded once on first call
_finbert_model = None
_finbert_tokenizer = None
_load_lock = asyncio.Lock()

FINBERT_MODEL_NAME = "ProsusAI/finbert"
MAX_TOKENS = 512
MAX_SECTIONS = 12          # cap to keep latency bounded
MIN_SECTION_CHARS = 80     # skip noise


# ── Model loader (sync, called inside a thread pool) ──────────────────────────
def _load_finbert_sync() -> tuple[Any, Any]:
    """Load FinBERT model + tokenizer. Called from a thread."""
    global _finbert_model, _finbert_tokenizer
    if _finbert_model is not None and _finbert_tokenizer is not None:
        return _finbert_model, _finbert_tokenizer

    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    log.info("Loading FinBERT model %r (first call may take ~30s)", FINBERT_MODEL_NAME)
    tokenizer = AutoTokenizer.from_pretrained(FINBERT_MODEL_NAME)
    model = AutoModelForSequenceClassification.from_pretrained(FINBERT_MODEL_NAME)
    model.eval()
    _finbert_tokenizer = tokenizer
    _finbert_model = model
    log.info("FinBERT loaded: labels=%s", model.config.id2label)
    return model, tokenizer


async def _ensure_loaded() -> tuple[Any, Any]:
    """Async-safe lazy load. Blocks event loop only on first call."""
    global _finbert_model, _finbert_tokenizer
    if _finbert_model is not None and _finbert_tokenizer is not None:
        return _finbert_model, _finbert_tokenizer
    async with _load_lock:
        if _finbert_model is None or _finbert_tokenizer is None:
            return await asyncio.to_thread(_load_finbert_sync)
        return _finbert_model, _finbert_tokenizer


# ── Section extraction ────────────────────────────────────────────────────────
def extract_management_commentary(content: str, doc_type: Optional[str] = None) -> list[str]:
    """
    Pull management commentary / forward-looking sections from a document.

    Heuristic-driven: looks for typical SEC and earnings-call section markers,
    falls back to forward-looking sentences if no structured section found.
    """
    if not content:
        return []

    sections: list[str] = []
    doc_type_lower = (doc_type or "").lower()

    if doc_type_lower in ("earnings_call", "earnings", "transcript"):
        # Earnings-call patterns: speaker turns ending at Q&A or operator
        patterns = [
            r"(?:Chief Executive Officer|CEO|President)[\s\S]{50,3000}?(?=(?:Chief Financial Officer|CFO|Operator|Question[- ]and[- ]Answer|Q\s*&\s*A))",
            r"(?:Chief Financial Officer|CFO)[\s\S]{50,3000}?(?=(?:CEO|Operator|Q\s*&\s*A))",
            r"(?:prepared remarks|opening remarks|management discussion)[\s\S]{50,3000}?(?=(?:Q\s*&\s*A|Operator|questions))",
        ]
    elif doc_type_lower in ("10-k", "10-q", "annual_report", "10k", "10q"):
        # SEC filing patterns: MD&A, Risk Factors, Outlook
        patterns = [
            r"(?:Item\s*[27][.A-Z]?\s*[—–-]?\s*)?Management['\u2019]?s?\s+Discussion\s+and\s+Analysis[\s\S]{200,5000}",
            r"(?:Item\s*1A[.A-Z]?\s*[—–-]?\s*)?Risk\s+Factors[\s\S]{200,5000}",
            r"Forward[- ]Looking\s+Statements[\s\S]{100,3000}",
            r"Outlook[\s\S]{100,3000}",
        ]
    else:
        patterns = []

    # First pass: structured patterns
    for pattern in patterns:
        for match in re.finditer(pattern, content, re.IGNORECASE):
            text = match.group(0).strip()
            if len(text) >= MIN_SECTION_CHARS:
                sections.append(text)

    # Fallback: forward-looking sentences (any document with no clear sections)
    if not sections:
        # Match sentences containing forward-looking language
        sentence_pattern = re.compile(
            r"[^.!?]*\b(?:expect|anticipate|believe|plan|intend|outlook|forecast|guidance|going forward|will|should|may|likely|opportunity|challenge|future|next year|upcoming|strategy|initiative|invest|grow|drive)\b[^.!?]*[.!?]",
            re.IGNORECASE,
        )
        for match in sentence_pattern.finditer(content):
            sentence = match.group(0).strip()
            if MIN_SECTION_CHARS <= len(sentence) <= 800:
                sections.append(sentence)

    # Dedupe (preserve order) and cap
    seen: set[str] = set()
    unique: list[str] = []
    for s in sections:
        key = s[:200].lower()
        if key in seen:
            continue
        seen.add(key)
        unique.append(s)
        if len(unique) >= MAX_SECTIONS:
            break

    return unique


# ── Single-text scoring ───────────────────────────────────────────────────────
def _score_text_sync(model: Any, tokenizer: Any, text: str) -> dict[str, float]:
    """Run FinBERT on one text. Sync, called inside a thread."""
    import torch
    import torch.nn.functional as F

    inputs = tokenizer(
        text, return_tensors="pt", truncation=True, max_length=MAX_TOKENS, padding=True
    )
    with torch.no_grad():
        outputs = model(**inputs)
    probs = F.softmax(outputs.logits, dim=-1)[0].tolist()

    # Map model id2label → fixed key set
    id2label = model.config.id2label
    scores: dict[str, float] = {"positive": 0.0, "neutral": 0.0, "negative": 0.0}
    for idx, prob in enumerate(probs):
        label = id2label.get(idx, str(idx)).lower()
        if label in scores:
            scores[label] = float(prob)
    return scores


async def score_text(text: str) -> dict[str, float]:
    """Score a single piece of text. Returns positive/neutral/negative probabilities."""
    if not text or not text.strip():
        return {"positive": 0.0, "neutral": 1.0, "negative": 0.0}
    try:
        model, tokenizer = await _ensure_loaded()
        return await asyncio.to_thread(_score_text_sync, model, tokenizer, text)
    except Exception as exc:
        log.error("FinBERT scoring failed for text: %s", exc)
        # Neutral fallback so the caller never crashes
        return {"positive": 0.33, "neutral": 0.34, "negative": 0.33}


# ── Document-level analysis ───────────────────────────────────────────────────
def _confidence(avg_dominant: float) -> str:
    if avg_dominant > 0.70:
        return "high"
    if avg_dominant > 0.50:
        return "medium"
    return "low"


async def analyze_document_sentiment(
    content: str,
    metadata: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """
    Analyze sentiment of management commentary in a document.

    Returns:
        {
            "overall_sentiment": {"positive": float, "neutral": float, "negative": float},
            "dominant_sentiment": "positive"|"neutral"|"negative",
            "confidence": "high"|"medium"|"low",
            "sections_analyzed": int,
            "sections": [{ "section_index": int, "text_preview": str, "sentiment": {...}, "dominant": str }],
            "model_used": "ProsusAI/finbert",
        }
    """
    metadata = metadata or {}
    doc_type = metadata.get("doc_type")

    sections = extract_management_commentary(content, doc_type)
    if not sections:
        log.info("No management commentary sections found for doc_type=%r", doc_type)
        return {
            "overall_sentiment": {"positive": 0.0, "neutral": 1.0, "negative": 0.0},
            "dominant_sentiment": "neutral",
            "confidence": "low",
            "sections_analyzed": 0,
            "sections": [],
            "model_used": FINBERT_MODEL_NAME,
            "warning": "no_management_commentary_found",
        }

    # Score each section
    section_results: list[dict[str, Any]] = []
    totals = {"positive": 0.0, "neutral": 0.0, "negative": 0.0}
    dominant_scores: list[float] = []

    for idx, section in enumerate(sections):
        scores = await score_text(section)
        dominant = max(scores, key=scores.get)
        section_results.append({
            "section_index": idx,
            "text_preview": (section[:240] + "…") if len(section) > 240 else section,
            "sentiment": scores,
            "dominant": dominant,
        })
        for key in totals:
            totals[key] += scores[key]
        dominant_scores.append(scores[dominant])

    n = len(sections)
    overall = {k: v / n for k, v in totals.items()}
    dominant_overall = max(overall, key=overall.get)
    confidence = _confidence(sum(dominant_scores) / n)

    return {
        "overall_sentiment": overall,
        "dominant_sentiment": dominant_overall,
        "confidence": confidence,
        "sections_analyzed": n,
        "sections": section_results,
        "model_used": FINBERT_MODEL_NAME,
    }


# ── Period-over-period comparison ─────────────────────────────────────────────
def compare_sentiment_periods(
    sentiment_a: dict[str, Any],
    sentiment_b: dict[str, Any],
) -> dict[str, Any]:
    """
    Compare two sentiment-analysis results to detect material shifts.

    A move from 0.80 positive to 0.50 positive is meaningful — flagged as 'major'.

    Returns:
        {
            "period_a_sentiment": {...},
            "period_b_sentiment": {...},
            "sentiment_shift": {direction, magnitude, significance},
            "detailed_changes": {positive_change, negative_change, neutral_change},
            "interpretation": "Plain English explanation",
        }
    """
    if "overall_sentiment" not in sentiment_a or "overall_sentiment" not in sentiment_b:
        return {"error": "invalid sentiment data"}

    a = sentiment_a["overall_sentiment"]
    b = sentiment_b["overall_sentiment"]

    pos_delta = b["positive"] - a["positive"]
    neg_delta = b["negative"] - a["negative"]
    neu_delta = b["neutral"] - a["neutral"]

    # The sign of pos_delta drives our headline interpretation.
    # If positive falls AND negative rises, that's a clear pessimism shift.
    # If positive rises AND negative falls, that's optimism.
    if abs(pos_delta) >= abs(neg_delta):
        direction = "more_positive" if pos_delta > 0 else "more_negative"
        magnitude = abs(pos_delta)
    else:
        direction = "more_negative" if neg_delta > 0 else "more_positive"
        magnitude = abs(neg_delta)

    # Significance buckets — a 0.30 swing is huge, 0.05 is noise
    if magnitude > 0.20:
        significance = "major"
    elif magnitude > 0.10:
        significance = "moderate"
    elif magnitude > 0.05:
        significance = "minor"
    else:
        significance = "negligible"

    period_a_payload = {
        "positive": a["positive"],
        "neutral": a["neutral"],
        "negative": a["negative"],
        "dominant": sentiment_a.get("dominant_sentiment") or max(a, key=a.get),
        "confidence": sentiment_a.get("confidence", "unknown"),
    }
    period_b_payload = {
        "positive": b["positive"],
        "neutral": b["neutral"],
        "negative": b["negative"],
        "dominant": sentiment_b.get("dominant_sentiment") or max(b, key=b.get),
        "confidence": sentiment_b.get("confidence", "unknown"),
    }

    return {
        "period_a_sentiment": period_a_payload,
        "period_b_sentiment": period_b_payload,
        "sentiment_shift": {
            "direction": direction,
            "magnitude": magnitude,
            "significance": significance,
        },
        "detailed_changes": {
            "positive_change": pos_delta,
            "negative_change": neg_delta,
            "neutral_change": neu_delta,
        },
        "interpretation": _interpret_shift(direction, magnitude, significance, a, b),
    }


def _interpret_shift(
    direction: str,
    magnitude: float,
    significance: str,
    a: dict[str, float],
    b: dict[str, float],
) -> str:
    """Generate a human-readable interpretation of a sentiment shift."""
    if significance == "negligible":
        return "Management tone was essentially unchanged between the two periods."

    direction_word = "more optimistic" if direction == "more_positive" else "more cautious"
    a_pos = f"{a['positive']:.2f}"
    b_pos = f"{b['positive']:.2f}"

    base = (
        f"Management tone became {direction_word} between periods — positive sentiment "
        f"moved from {a_pos} to {b_pos} (change magnitude {magnitude:.2f})."
    )

    if significance == "major":
        return base + " This is a material shift in outlook and warrants follow-up analysis."
    if significance == "moderate":
        return base + " This is a notable shift suggesting evolving management perspective."
    return base + " This is a subtle but observable change in tone."
