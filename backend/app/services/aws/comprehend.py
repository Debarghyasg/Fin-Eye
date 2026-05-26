"""
AWS Comprehend — PII detection adapter.

Historically this module ran AWS Comprehend's ``DetectPiiEntities`` against
extracted document text. As of PR 1 the primary scanner has moved to
:mod:`app.services.compliance.pii_scanner` (Microsoft Presidio + spaCy with
regex fallback) which is the recommended free alternative documented in the
project spec.

This file is kept as a thin compatibility shim so existing call sites
(`from app.services.aws.comprehend import scan_for_pii`) continue to work
unmodified, and so that swapping back to AWS Comprehend in production is a
single-file change.

Production swap
---------------
To use AWS Comprehend in production:
1. Set ``ENVIRONMENT=production`` and provide AWS credentials.
2. Replace the body of :func:`scan_for_pii` below with a Comprehend client call
   (the historical implementation is preserved in git history at the parent
   commit of PR 1) and gate it behind a ``USE_COMPREHEND`` flag.
3. The returned :class:`PIIResult` shape is identical, so no caller changes.
"""
from __future__ import annotations

from app.services.compliance.pii_scanner import PIIResult, scan_for_pii

__all__ = ["PIIResult", "scan_for_pii"]
