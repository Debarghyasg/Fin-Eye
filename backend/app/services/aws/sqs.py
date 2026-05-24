"""
SQS service — publish document-processing events to the queue.

The document upload endpoint publishes a message immediately after writing
the S3 object. A separate Lambda (or background worker in dev) consumes
the queue and runs extraction → chunking → embedding in sequence.

Message schema
--------------
{
    "event": "document.uploaded",
    "document_id": "<uuid>",
    "workspace_id": "<uuid>",
    "s3_key": "documents/<id>/original/<filename>",
    "mime_type": "application/pdf",
    "timestamp": "2024-01-01T00:00:00Z"
}
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

import boto3
from botocore.exceptions import ClientError
from tenacity import retry, stop_after_attempt, wait_exponential

from app.core.config import settings

log = logging.getLogger(__name__)


def _sqs_client() -> Any:
    kwargs: dict[str, Any] = dict(
        region_name=settings.AWS_REGION,
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
    )
    if settings.AWS_ENDPOINT_URL:
        kwargs["endpoint_url"] = settings.AWS_ENDPOINT_URL
    return boto3.client("sqs", **kwargs)


def ensure_queue_exists() -> str:
    """
    Create the SQS queue if it doesn't exist (idempotent).
    Returns the queue URL.
    """
    client = _sqs_client()
    queue_name = settings.SQS_DOCUMENT_QUEUE_URL.rstrip("/").split("/")[-1]
    try:
        resp = client.create_queue(
            QueueName=queue_name,
            Attributes={
                "VisibilityTimeout": "300",          # 5 minutes processing window
                "MessageRetentionPeriod": "86400",   # 24 hours
                "ReceiveMessageWaitTimeSeconds": "20",  # long-polling
            },
        )
        url: str = resp["QueueUrl"]
        log.info("SQS queue ready: %s", url)
        return url
    except ClientError as e:
        if e.response["Error"]["Code"] == "QueueAlreadyExists":
            return settings.SQS_DOCUMENT_QUEUE_URL
        raise


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=8))
def publish_document_uploaded(
    document_id: str,
    workspace_id: str,
    s3_key: str,
    mime_type: str,
) -> str:
    """
    Publish a 'document.uploaded' event to SQS.

    Returns the SQS MessageId on success.
    Retries up to 3× with exponential back-off.
    """
    client = _sqs_client()
    message: dict[str, Any] = {
        "event": "document.uploaded",
        "document_id": document_id,
        "workspace_id": workspace_id,
        "s3_key": s3_key,
        "mime_type": mime_type,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    resp = client.send_message(
        QueueUrl=settings.SQS_DOCUMENT_QUEUE_URL,
        MessageBody=json.dumps(message),
        MessageAttributes={
            "event_type": {
                "StringValue": "document.uploaded",
                "DataType": "String",
            }
        },
    )
    msg_id: str = resp["MessageId"]
    log.info(
        "SQS event published: document_id=%s message_id=%s",
        document_id,
        msg_id,
    )
    return msg_id


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=8))
def receive_messages(max_messages: int = 10) -> list[dict[str, Any]]:
    """
    Poll the queue for up to `max_messages` messages (long-poll, 20 s).
    Used by the local dev worker / tests.
    Returns a list of parsed message dicts.
    """
    client = _sqs_client()
    resp = client.receive_message(
        QueueUrl=settings.SQS_DOCUMENT_QUEUE_URL,
        MaxNumberOfMessages=min(max_messages, 10),
        WaitTimeSeconds=20,
        MessageAttributeNames=["All"],
    )
    messages = resp.get("Messages", [])
    return [
        {
            "receipt_handle": m["ReceiptHandle"],
            "body": json.loads(m["Body"]),
        }
        for m in messages
    ]


def delete_message(receipt_handle: str) -> None:
    """Acknowledge (delete) a processed SQS message."""
    client = _sqs_client()
    client.delete_message(
        QueueUrl=settings.SQS_DOCUMENT_QUEUE_URL,
        ReceiptHandle=receipt_handle,
    )
