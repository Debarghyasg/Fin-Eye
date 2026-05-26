"""
Fernet encryption-at-rest helper.

Wraps `cryptography.fernet.Fernet` (AES-128-CBC + HMAC-SHA256, MIT-licensed)
behind a small, transparent interface used by the storage layer.

Design notes
------------
* **Magic prefix** — encrypted blobs start with the 4-byte tag b"FNT1" so the
  storage layer can distinguish encrypted from plaintext bytes. This lets us
  enable encryption on an existing system without re-encrypting historical
  uploads: legacy bytes round-trip unchanged.
* **Pass-through when disabled** — if ``FERNET_KEY`` is blank or
  ``ENCRYPT_AT_REST=false``, ``encrypt_bytes()`` and ``decrypt_bytes()`` are
  no-ops. This keeps local dev frictionless for first-time setup.
* **Lazy init** — the Fernet object is built once via ``functools.lru_cache``
  on first use, never at import time, so a missing/invalid key only fails the
  upload that needs it (not the whole app boot).
* **Strict mode in production** — when ``ENVIRONMENT=production`` and
  encryption is "on" but no key is configured, ``encrypt_bytes`` raises
  RuntimeError. Storing a financial document unencrypted in prod would be a
  compliance failure.

AWS production mapping
----------------------
Swap this module's ``encrypt_bytes`` / ``decrypt_bytes`` calls for AWS KMS
``Encrypt`` / ``Decrypt`` (or S3 SSE-KMS at the bucket level). The storage
layer doesn't change.
"""
from __future__ import annotations

import logging
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings

log = logging.getLogger(__name__)

# 4-byte tag — present at the start of every blob this module encrypts.
# Anything not starting with this tag is treated as plaintext on decrypt.
_MAGIC = b"FNT1"


# ── Public API ────────────────────────────────────────────────────────────────
def encryption_enabled() -> bool:
    """True iff the storage layer should call encrypt_bytes() before writing."""
    return bool(settings.ENCRYPT_AT_REST and settings.FERNET_KEY)


def encrypt_bytes(data: bytes) -> bytes:
    """
    Encrypt ``data`` with the configured Fernet key and prepend the magic tag.

    When encryption is disabled this is a no-op and returns ``data`` unchanged.
    Raises RuntimeError in production if encryption is requested but no key is
    set — never silently store an unencrypted document in prod.
    """
    if not settings.ENCRYPT_AT_REST:
        return data

    if not settings.FERNET_KEY:
        if settings.ENVIRONMENT == "production":
            raise RuntimeError(
                "ENCRYPT_AT_REST=true and ENVIRONMENT=production but FERNET_KEY "
                "is blank. Refusing to store an unencrypted document. Generate a "
                "key with: python -c 'from cryptography.fernet import Fernet; "
                "print(Fernet.generate_key().decode())'"
            )
        # Dev-friendly fallback: warn once per process, then pass through.
        _warn_dev_no_key()
        return data

    fernet = _get_fernet()
    return _MAGIC + fernet.encrypt(data)


def decrypt_bytes(blob: bytes) -> bytes:
    """
    Reverse of :func:`encrypt_bytes`.

    * If ``blob`` doesn't carry the magic prefix → treat as plaintext, return
      unchanged. This handles legacy uploads predating encryption.
    * If it carries the prefix but no key is configured → raise: the data is
      genuinely encrypted and we cannot read it.
    * If decryption fails (tampering, wrong key) → raise InvalidToken.
    """
    if not blob.startswith(_MAGIC):
        # Plaintext — either encryption is disabled or this is a legacy upload.
        return blob

    if not settings.FERNET_KEY:
        raise RuntimeError(
            "Stored object is Fernet-encrypted but FERNET_KEY is not configured. "
            "Cannot decrypt without the key that wrote this blob."
        )

    fernet = _get_fernet()
    try:
        return fernet.decrypt(blob[len(_MAGIC):])
    except InvalidToken as exc:
        raise RuntimeError(
            "Fernet decryption failed — the configured FERNET_KEY does not "
            "match the key used to encrypt this blob."
        ) from exc


# ── Internals ─────────────────────────────────────────────────────────────────
@lru_cache(maxsize=1)
def _get_fernet() -> Fernet:
    """
    Build the Fernet object once.

    Raises ValueError if the configured key is malformed (Fernet requires a
    URL-safe base64 32-byte key).
    """
    key = settings.FERNET_KEY.encode() if isinstance(settings.FERNET_KEY, str) else settings.FERNET_KEY
    return Fernet(key)


@lru_cache(maxsize=1)
def _warn_dev_no_key() -> None:
    """Log the no-key warning exactly once per process (cached)."""
    log.warning(
        "FERNET_KEY is blank in %s mode — documents are being stored UNENCRYPTED. "
        "This is acceptable for local dev only. Generate a key with: "
        "`python -c \"from cryptography.fernet import Fernet; "
        "print(Fernet.generate_key().decode())\"`",
        settings.ENVIRONMENT,
    )
