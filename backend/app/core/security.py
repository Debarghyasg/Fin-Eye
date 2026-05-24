"""
Clerk JWT validation.

Clerk issues RS256 JWTs. We fetch the public keys from Clerk's JWKS endpoint,
cache them in memory, and verify every incoming Bearer token against them.

Flow:
  1. Extract Bearer token from Authorization header.
  2. Decode the token header to find the `kid` (key ID).
  3. Fetch the matching public key from Clerk's JWKS endpoint (cached 1 h).
  4. Verify signature, expiry, and issuer.
  5. Return the decoded payload as a dict.
"""
from __future__ import annotations

import time
from typing import Any

import httpx
from jose import JWTError, jwk, jwt
from jose.utils import base64url_decode

from app.core.config import settings

# ── JWKS in-memory cache ──────────────────────────────────────────────────────
_jwks_cache: dict[str, Any] = {}
_jwks_fetched_at: float = 0.0
_JWKS_TTL = 3600  # seconds


async def _get_jwks() -> dict[str, Any]:
    """Fetch Clerk's JWKS, cache for 1 hour."""
    global _jwks_cache, _jwks_fetched_at

    if _jwks_cache and (time.time() - _jwks_fetched_at) < _JWKS_TTL:
        return _jwks_cache

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(settings.CLERK_JWKS_URL)
        resp.raise_for_status()
        data = resp.json()

    _jwks_cache = {key["kid"]: key for key in data.get("keys", [])}
    _jwks_fetched_at = time.time()
    return _jwks_cache


async def verify_clerk_token(token: str) -> dict[str, Any]:
    """
    Verify a Clerk JWT and return the decoded payload.

    Raises ValueError with a descriptive message on any failure —
    the dependency layer converts these into 401 HTTPExceptions.
    """
    # ── 1. Peek at header to find kid ────────────────────────────
    try:
        unverified_header = jwt.get_unverified_header(token)
    except JWTError as exc:
        raise ValueError(f"Invalid JWT header: {exc}") from exc

    kid = unverified_header.get("kid")
    if not kid:
        raise ValueError("JWT is missing 'kid' in header")

    # ── 2. Fetch matching public key ─────────────────────────────
    jwks = await _get_jwks()
    if kid not in jwks:
        # Key not in cache — force refresh once
        jwks = await _get_jwks.__wrapped__() if hasattr(_get_jwks, "__wrapped__") else await _get_jwks()  # type: ignore[attr-defined]
        # Rebuild cache and retry
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(settings.CLERK_JWKS_URL)
            resp.raise_for_status()
            data = resp.json()
        jwks = {key["kid"]: key for key in data.get("keys", [])}
        global _jwks_cache, _jwks_fetched_at
        _jwks_cache = jwks
        _jwks_fetched_at = time.time()

    if kid not in jwks:
        raise ValueError(f"No public key found for kid={kid!r}")

    public_key = jwk.construct(jwks[kid])

    # ── 3. Verify + decode ───────────────────────────────────────
    try:
        options: dict[str, Any] = {
            "verify_exp": True,
            "verify_aud": bool(settings.CLERK_JWT_AUDIENCE),
        }
        audience = settings.CLERK_JWT_AUDIENCE if settings.CLERK_JWT_AUDIENCE else None
        payload: dict[str, Any] = jwt.decode(
            token,
            public_key,
            algorithms=["RS256"],
            audience=audience,
            options=options,
        )
    except JWTError as exc:
        raise ValueError(f"JWT verification failed: {exc}") from exc

    return payload


def extract_user_id(payload: dict[str, Any]) -> str:
    """
    Pull the Clerk user ID (sub claim) from a verified JWT payload.
    Clerk's user IDs look like: user_2abc123xyz
    """
    sub = payload.get("sub")
    if not sub:
        raise ValueError("JWT payload missing 'sub' claim")
    return str(sub)


def extract_user_email(payload: dict[str, Any]) -> str | None:
    """
    Pull the primary email from a verified JWT payload.
    Clerk puts email in 'email' or inside 'email_addresses'.
    """
    return payload.get("email") or None
