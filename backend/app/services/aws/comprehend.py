"""
PII detection — local Presidio + regex (no AWS).

AWS Comprehend has been removed from the pipeline.  All PII scanning runs
locally via Microsoft Presidio + spaCy (with a regex fallback) in
:mod:`app.services.compliance.pii_scanner`.

This shim is kept so any historical import of
``app.services.aws.comprehend.scan_for_pii`` continues to resolve without
modification to the call site.
"""
from __future__ import annotations

from app.services.compliance.pii_scanner import PIIResult, scan_for_pii

__all__ = ["PIIResult", "scan_for_pii"]
