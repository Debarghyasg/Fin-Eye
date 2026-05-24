"""
S3 service — upload, download, delete, and presigned URL generation.

Works transparently with both real AWS and LocalStack.
Set AWS_ENDPOINT_URL=http://localhost:4566 in .env for local dev.
"""
from __future__ import annotations

import io
import json
import logging
from typing import Any

import boto3
from botocore.exceptions import ClientError
from tenacity import retry, stop_after_attempt, wait_exponential

from app.core.config import settings

log = logging.getLogger(__name__)


def _s3_client() -> Any:
    """Build a boto3 S3 client. Endpoint URL is None for real AWS."""
    kwargs: dict[str, Any] = dict(
        region_name=settings.AWS_REGION,
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
    )
    if settings.AWS_ENDPOINT_URL:
        kwargs["endpoint_url"] = settings.AWS_ENDPOINT_URL
    return boto3.client("s3", **kwargs)


# ── Bucket bootstrap (called once at startup) ─────────────────────────────────
def ensure_bucket_exists() -> None:
    """Create the S3 bucket if it doesn't already exist (idempotent)."""
    client = _s3_client()
    try:
        client.head_bucket(Bucket=settings.S3_BUCKET_NAME)
        log.info("S3 bucket %r already exists", settings.S3_BUCKET_NAME)
    except ClientError as e:
        code = e.response["Error"]["Code"]
        if code in ("404", "NoSuchBucket"):
            log.info("Creating S3 bucket %r", settings.S3_BUCKET_NAME)
            if settings.AWS_REGION == "us-east-1":
                client.create_bucket(Bucket=settings.S3_BUCKET_NAME)
            else:
                client.create_bucket(
                    Bucket=settings.S3_BUCKET_NAME,
                    CreateBucketConfiguration={"LocationConstraint": settings.AWS_REGION},
                )
        else:
            raise


# ── Upload ────────────────────────────────────────────────────────────────────
@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=8))
def upload_fileobj(
    file_data: bytes | io.BytesIO,
    s3_key: str,
    content_type: str = "application/octet-stream",
    metadata: dict[str, str] | None = None,
) -> str:
    """
    Upload bytes or a file-like object to S3.

    Returns the S3 key on success.
    Retries up to 3× with exponential back-off.
    """
    client = _s3_client()
    body = file_data if isinstance(file_data, (bytes, bytearray)) else file_data
    extra: dict[str, Any] = {"ContentType": content_type}
    if metadata:
        extra["Metadata"] = metadata

    client.put_object(
        Bucket=settings.S3_BUCKET_NAME,
        Key=s3_key,
        Body=body,
        **extra,
    )
    log.info("Uploaded s3://%s/%s (%s)", settings.S3_BUCKET_NAME, s3_key, content_type)
    return s3_key


# ── Download ──────────────────────────────────────────────────────────────────
@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=8))
def download_fileobj(s3_key: str) -> bytes:
    """Download an object from S3 and return its content as bytes."""
    client = _s3_client()
    response = client.get_object(Bucket=settings.S3_BUCKET_NAME, Key=s3_key)
    data: bytes = response["Body"].read()
    log.debug("Downloaded s3://%s/%s (%d bytes)", settings.S3_BUCKET_NAME, s3_key, len(data))
    return data


# ── Upload JSON (for extracted text payloads) ─────────────────────────────────
def upload_json(payload: dict[str, Any], s3_key: str) -> str:
    """Serialise a dict to JSON and upload it to S3."""
    body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
    return upload_fileobj(body, s3_key, content_type="application/json")


# ── Delete ────────────────────────────────────────────────────────────────────
def delete_object(s3_key: str) -> None:
    """Delete a single object from S3 (no-op if key doesn't exist)."""
    client = _s3_client()
    try:
        client.delete_object(Bucket=settings.S3_BUCKET_NAME, Key=s3_key)
        log.info("Deleted s3://%s/%s", settings.S3_BUCKET_NAME, s3_key)
    except ClientError as e:
        log.warning("S3 delete failed for %r: %s", s3_key, e)


# ── Presigned URL ─────────────────────────────────────────────────────────────
def generate_presigned_url(s3_key: str, expiry: int | None = None) -> str:
    """
    Generate a presigned GET URL for temporary direct-download access.
    Default expiry is taken from settings (1 hour).
    """
    client = _s3_client()
    url: str = client.generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.S3_BUCKET_NAME, "Key": s3_key},
        ExpiresIn=expiry or settings.S3_PRESIGNED_URL_EXPIRY,
    )
    return url


# ── Key builders (consistent naming across all services) ─────────────────────
def original_key(document_id: str, filename: str) -> str:
    """e.g. documents/abc-123/original/Apple_10K_2023.pdf"""
    return f"documents/{document_id}/original/{filename}"


def extracted_key(document_id: str) -> str:
    """e.g. documents/abc-123/extracted/content.json"""
    return f"documents/{document_id}/extracted/content.json"
