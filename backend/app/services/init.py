"""
Application initialization service.

Sets up AWS resources (S3 buckets, DynamoDB tables) on startup.
Works with both real AWS and LocalStack for development.
"""
from __future__ import annotations

import logging

from app.core.config import settings

log = logging.getLogger(__name__)


async def initialize_aws_resources() -> None:
    """
    Initialize AWS resources on application startup.
    
    Creates S3 buckets and DynamoDB tables if they don't exist.
    Safe to call multiple times (idempotent operations).
    """
    if settings.USE_S3:
        try:
            from app.services.aws.s3 import ensure_bucket_exists
            ensure_bucket_exists()
            log.info("S3 bucket initialization complete")
        except Exception as exc:
            log.warning("S3 initialization failed: %s", exc)
    
    if settings.USE_DYNAMODB:
        try:
            from app.services.aws.dynamodb import ensure_audit_table_exists
            ensure_audit_table_exists()
            log.info("DynamoDB audit table initialization complete")
        except Exception as exc:
            log.warning("DynamoDB initialization failed: %s", exc)
    
    log.info("AWS resource initialization complete")


async def initialize_all() -> None:
    """Initialize all application resources."""
    log.info("Starting application initialization")
    
    # Initialize AWS resources if enabled
    await initialize_aws_resources()
    
    log.info("Application initialization complete")