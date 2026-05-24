"""
Storage abstraction — switches between local filesystem and S3.

USE_S3=false (default, free)  → files saved to LOCAL_STORAGE_PATH (/app/uploads)
USE_S3=true  (paid upgrade)   → files go to AWS S3

All route and pipeline code imports `storage` from here.
No other file should import from app.services.aws.s3 directly.

Public API
----------
  storage.upload(data, key, content_type, metadata) → str (key)
  storage.download(key)                             → bytes
  storage.upload_json(payload, key)                 → str (key)
  storage.delete(key)                               → None
  storage.original_key(document_id, filename)       → str
  storage.extracted_key(document_id)                → str
"""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any

from app.core.config import settings

log = logging.getLogger(__name__)



class _LocalStorage:
    """Stores files under LOCAL_STORAGE_PATH using the S3 key as a relative path."""

    def __init__(self, base: str):
        self._base = Path(base)
        self._base.mkdir(parents=True, exist_ok=True)
        log.info("Local storage initialised at %s", self._base)

    def _path(self, key: str) -> Path:
        p = self._base / key
        p.parent.mkdir(parents=True, exist_ok=True)
        return p

    def upload(
        self,
        data: bytes,
        key: str,
        content_type: str = "application/octet-stream",
        metadata: dict[str, str] | None = None,
    ) -> str:
        self._path(key).write_bytes(data)
        log.debug("Local upload: %s (%d bytes)", key, len(data))
        return key

    def download(self, key: str) -> bytes:
        p = self._path(key)
        if not p.exists():
            raise FileNotFoundError(f"Local file not found: {key}")
        return p.read_bytes()

    def upload_json(self, payload: dict[str, Any], key: str) -> str:
        data = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        return self.upload(data, key, content_type="application/json")

    def delete(self, key: str) -> None:
        p = self._path(key)
        if p.exists():
            p.unlink()
            log.debug("Local delete: %s", key)

    def generate_presigned_url(self, key: str, expiry: int = 3600) -> str:
        # In local dev just return a placeholder URL
        return f"http://localhost:8000/files/{key}"


# ── S3 backend (used when USE_S3=true) ───────────────────────────────────────
class _S3Storage:
    def upload(
        self,
        data: bytes,
        key: str,
        content_type: str = "application/octet-stream",
        metadata: dict[str, str] | None = None,
    ) -> str:
        from app.services.aws.s3 import upload_fileobj
        return upload_fileobj(data, key, content_type, metadata)

    def download(self, key: str) -> bytes:
        from app.services.aws.s3 import download_fileobj
        return download_fileobj(key)

    def upload_json(self, payload: dict[str, Any], key: str) -> str:
        from app.services.aws.s3 import upload_json
        return upload_json(payload, key)

    def delete(self, key: str) -> None:
        from app.services.aws.s3 import delete_object
        delete_object(key)

    def generate_presigned_url(self, key: str, expiry: int = 3600) -> str:
        from app.services.aws.s3 import generate_presigned_url
        return generate_presigned_url(key, expiry)


# ── Key builders (same regardless of backend) ─────────────────────────────────
def original_key(document_id: str, filename: str) -> str:
    return f"documents/{document_id}/original/{filename}"


def extracted_key(document_id: str) -> str:
    return f"documents/{document_id}/extracted/content.json"


# ── Public interface ──────────────────────────────────────────────────────────
class _Storage:
    """Unified storage interface. Delegates to local or S3 based on settings."""

    def __init__(self):
        self._backend: _LocalStorage | _S3Storage | None = None

    def _get(self):
        if self._backend is None:
            if settings.USE_S3:
                self._backend = _S3Storage()
                log.info("Storage backend: AWS S3 bucket=%s", settings.S3_BUCKET_NAME)
            else:
                self._backend = _LocalStorage(settings.LOCAL_STORAGE_PATH)
        return self._backend

    def upload(self, data: bytes, key: str, content_type: str = "application/octet-stream",
               metadata: dict | None = None) -> str:
        return self._get().upload(data, key, content_type, metadata)

    def download(self, key: str) -> bytes:
        return self._get().download(key)

    def upload_json(self, payload: dict, key: str) -> str:
        return self._get().upload_json(payload, key)

    def delete(self, key: str) -> None:
        self._get().delete(key)

    def generate_presigned_url(self, key: str, expiry: int = 3600) -> str:
        return self._get().generate_presigned_url(key, expiry)

    # Key builders attached to the interface for convenience
    @staticmethod
    def original_key(document_id: str, filename: str) -> str:
        return original_key(document_id, filename)

    @staticmethod
    def extracted_key(document_id: str) -> str:
        return extracted_key(document_id)


storage = _Storage()
