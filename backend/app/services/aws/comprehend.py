"""
AWS Comprehend — PII detection service.

Before a document's text is stored anywhere, we scan it with Comprehend to
detect PII entities (names, SSNs, credit-card numbers, etc.).

This runs as a blocking gate BEFORE the extracted JSON is written to S3.
If PII is found above the threshold, the document is flagged and analysts
must acknowledge it before it proceeds to chunking.

LocalStack note: Comprehend PII detection is not supported by LocalStack Community.
In local dev the service falls back to a regex-based heuristic scan.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Any

import boto3
from botocore.exceptions import ClientError

from app.core.config import settings

log = logging.getLogger(__name__)

# PII types we always flag regardless of confidence score
_HIGH_RISK_TYPES = {
    "SSN",
    "CREDIT_DEBIT_NUMBER",
    "BANK_ACCOUNT_NUMBER",
    "PASSPORT_NUMBER",
    "PIN",
    "PASSWORD",
    "AWS_SECRET_KEY",
}

# Minimum Comprehend score to count as a detection
_MIN_SCORE = 0.80

# ── Regex fallback for local dev (no real Comprehend) ─────────────────────────
_PII_PATTERNS = [
    ("SSN",                re.compile(r"\b\d{3}-\d{2}-\d{4}\b")),
    ("CREDIT_DEBIT_NUMBER",re.compile(r"\b(?:\d[ -]?){15,16}\b")),
    ("EMAIL",              re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b")),
    ("PHONE",              re.compile(r"\b(\+\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b")),
]


@dataclass
class PIIResult:
    passed: bool                    # True → no problematic PII found
    entities: list[dict[str, Any]]  # list of detected entity dicts
    flagged_types: list[str]        # high-risk types found


def _comprehend_client() -> Any:
    kwargs: dict[str, Any] = dict(
        region_name=settings.AWS_REGION,
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
    )
    if settings.AWS_ENDPOINT_URL:
        kwargs["endpoint_url"] = settings.AWS_ENDPOINT_URL
    return boto3.client("comprehend", **kwargs)


def _regex_scan(text: str) -> PIIResult:
    """Fallback heuristic PII scan using regex (used in local dev)."""
    entities: list[dict[str, Any]] = []
    for entity_type, pattern in _PII_PATTERNS:
        for m in pattern.finditer(text):
            entities.append({
                "Type": entity_type,
                "BeginOffset": m.start(),
                "EndOffset": m.end(),
                "Score": 1.0,
                "Source": "regex_fallback",
            })

    flagged = [e["Type"] for e in entities if e["Type"] in _HIGH_RISK_TYPES]
    return PIIResult(
        passed=len(flagged) == 0,
        entities=entities,
        flagged_types=flagged,
    )


def scan_for_pii(text: str) -> PIIResult:
    """
    Scan `text` for PII using AWS Comprehend.

    Falls back to regex scanning when:
      - AWS_ENDPOINT_URL points to LocalStack (Comprehend not supported)
      - Any ClientError is raised

    Returns a PIIResult with:
      - passed=True  → safe to store
      - passed=False → flagged, should block progression to chunking
    """
    # Comprehend has a 5,000 byte limit per call; truncate for the scan
    sample = text[:5000] if len(text) > 5000 else text

    # Use regex fallback in local dev
    if settings.AWS_ENDPOINT_URL:
        log.debug("Comprehend not available via LocalStack — using regex PII scan")
        return _regex_scan(sample)

    client = _comprehend_client()
    try:
        resp = client.detect_pii_entities(Text=sample, LanguageCode="en")
    except ClientError as e:
        log.warning("Comprehend API error — falling back to regex scan: %s", e)
        return _regex_scan(sample)

    entities: list[dict[str, Any]] = [
        e for e in resp.get("Entities", []) if e.get("Score", 0) >= _MIN_SCORE
    ]

    flagged = [
        e["Type"] for e in entities if e["Type"] in _HIGH_RISK_TYPES
    ]

    return PIIResult(
        passed=len(flagged) == 0,
        entities=entities,
        flagged_types=flagged,
    )
