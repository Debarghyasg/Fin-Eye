"""
PII scanner — Microsoft Presidio + spaCy with regex fallback.

This is the production-grade PII detection layer mandated by the PDF spec
(Section 0 + Section 10). It scans extracted document text for 50+ entity
types — names, SSNs, credit-card numbers, bank accounts, passports, etc. —
using two lines of defence:

1. **Presidio + spaCy** (default).
   ``USE_PRESIDIO=true`` enables the Microsoft Presidio analyzer with the
   ``en_core_web_sm`` spaCy NER model. This is the same library that powers
   AWS Comprehend's ``DetectPiiEntities`` API and is the recommended free
   alternative for enterprise document scanning.

2. **Regex fallback**.
   If Presidio fails to import (model missing, version mismatch, …) or
   ``USE_PRESIDIO=false``, the scanner falls back to a hand-curated regex
   pass that catches the highest-risk types (SSN, credit card, email, phone).
   The pipeline is therefore *never* gated on optional dependencies.

API
---
``scan_for_pii(text: str) -> PIIResult`` — same return shape as the legacy
:func:`app.services.aws.comprehend.scan_for_pii` so existing call sites need
no modification.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any

from app.core.config import settings

log = logging.getLogger(__name__)

# Maximum characters scanned per call. Presidio is comfortable with long text,
# but capping protects upload latency on 300-page 10-Ks.
_MAX_SCAN_CHARS = 100_000

# Entity types that fail the scan (passed=False) regardless of context.
# Names cover both Presidio's native ids and the legacy regex labels so the
# decision logic is uniform.
_HIGH_RISK_TYPES = frozenset({
    # Presidio-native ids
    "US_SSN", "CREDIT_CARD", "US_BANK_NUMBER", "US_PASSPORT",
    "US_DRIVER_LICENSE", "US_ITIN", "IBAN_CODE", "MEDICAL_LICENSE",
    "CRYPTO",
    # Legacy regex labels (kept in fallback)
    "SSN", "CREDIT_DEBIT_NUMBER", "BANK_ACCOUNT_NUMBER",
    "PASSPORT_NUMBER", "PIN", "PASSWORD", "AWS_SECRET_KEY",
})

# ── Regex fallback patterns ──────────────────────────────────────────────────
_REGEX_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("SSN",                 re.compile(r"\b\d{3}-\d{2}-\d{4}\b")),
    ("CREDIT_DEBIT_NUMBER", re.compile(r"\b(?:\d[ -]?){15,16}\b")),
    ("EMAIL",               re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")),
    ("PHONE",               re.compile(r"\b(\+\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b")),
    ("AWS_SECRET_KEY",      re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b")),
    ("IPV4",                re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")),
]


# ── Result type (shape-compatible with legacy comprehend.PIIResult) ───────────
@dataclass
class PIIResult:
    """Outcome of a PII scan.

    Attributes
    ----------
    passed
        ``True`` when no high-risk entity was detected. Callers should block
        downstream processing (chunking, embedding) when this is ``False``.
    entities
        Raw detection records. Each is a dict with at least
        ``Type`` (str), ``Score`` (float 0-1), ``BeginOffset`` (int) and
        ``EndOffset`` (int). Extra keys may appear and should be ignored.
    flagged_types
        Convenience list of high-risk types that were found.
    scanner
        Which engine produced the result — useful in logs and audit metadata.
    """
    passed: bool
    entities: list[dict[str, Any]] = field(default_factory=list)
    flagged_types: list[str] = field(default_factory=list)
    scanner: str = "regex"


# ── Public entry point ────────────────────────────────────────────────────────
def scan_for_pii(text: str) -> PIIResult:
    """Run PII detection against ``text`` and return a :class:`PIIResult`.

    The scanner is chosen at call time:

    * ``USE_PRESIDIO=true`` and Presidio importable → Presidio analysis.
    * Otherwise → regex fallback.

    The function never raises on detection errors — any internal failure
    degrades to the regex path so the upload pipeline is never blocked by
    optional infrastructure.
    """
    if not text:
        return PIIResult(passed=True, scanner="empty")

    sample = text[:_MAX_SCAN_CHARS]

    if settings.USE_PRESIDIO:
        try:
            return _presidio_scan(sample)
        except Exception as exc:  # pragma: no cover - defensive
            log.warning(
                "Presidio PII scan failed (%s); falling back to regex.",
                exc,
            )

    return _regex_scan(sample)


# ── Presidio implementation ──────────────────────────────────────────────────
def _presidio_scan(text: str) -> PIIResult:
    analyzer = _get_analyzer()
    results = analyzer.analyze(
        text=text,
        language=settings.PRESIDIO_LANGUAGE,
        score_threshold=settings.PRESIDIO_MIN_SCORE,
    )

    entities: list[dict[str, Any]] = [
        {
            "Type": r.entity_type,
            "BeginOffset": r.start,
            "EndOffset": r.end,
            "Score": float(r.score),
            "Source": "presidio",
        }
        for r in results
    ]
    flagged = sorted({e["Type"] for e in entities if e["Type"] in _HIGH_RISK_TYPES})
    return PIIResult(
        passed=not flagged,
        entities=entities,
        flagged_types=flagged,
        scanner="presidio",
    )


@lru_cache(maxsize=1)
def _get_analyzer():
    """Lazily build and cache the Presidio AnalyzerEngine.

    Importing presidio_analyzer triggers spaCy model loading (~15s on first
    run), so we defer it until the first upload that actually needs PII
    scanning. Cached for the rest of the process.
    """
    from presidio_analyzer import AnalyzerEngine
    from presidio_analyzer.nlp_engine import NlpEngineProvider

    nlp_config = {
        "nlp_engine_name": "spacy",
        "models": [
            {"lang_code": settings.PRESIDIO_LANGUAGE,
             "model_name": settings.PRESIDIO_SPACY_MODEL},
        ],
    }
    nlp_engine = NlpEngineProvider(nlp_configuration=nlp_config).create_engine()

    analyzer = AnalyzerEngine(
        nlp_engine=nlp_engine,
        supported_languages=[settings.PRESIDIO_LANGUAGE],
    )
    log.info(
        "Presidio analyzer initialised (lang=%s, spacy=%s, recognizers=%d)",
        settings.PRESIDIO_LANGUAGE,
        settings.PRESIDIO_SPACY_MODEL,
        len(analyzer.registry.recognizers),
    )
    return analyzer


# ── Regex fallback ────────────────────────────────────────────────────────────
def _regex_scan(text: str) -> PIIResult:
    entities: list[dict[str, Any]] = []
    for entity_type, pattern in _REGEX_PATTERNS:
        for m in pattern.finditer(text):
            entities.append({
                "Type": entity_type,
                "BeginOffset": m.start(),
                "EndOffset": m.end(),
                "Score": 1.0,
                "Source": "regex_fallback",
            })

    flagged = sorted({e["Type"] for e in entities if e["Type"] in _HIGH_RISK_TYPES})
    return PIIResult(
        passed=not flagged,
        entities=entities,
        flagged_types=flagged,
        scanner="regex",
    )
