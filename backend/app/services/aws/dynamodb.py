"""
DynamoDB audit logging service.

Every RAG query writes to DynamoDB for comprehensive audit trail.
Complies with SEC Rule 17a-4 record retention requirements (7 years).

Table schema
------------
  Partition key: workspace_id (String)
  Sort key:      query_timestamp (String, ISO format)
  TTL:          expires_at (Number, epoch seconds)
  
  Attributes:
    - query_log_id (String)      # Links to PostgreSQL query_logs table
    - user_id (String)
    - query_text (String)
    - answer_text (String)
    - confidence_score (Number)
    - chunk_ids (List[String])   # All chunk IDs used
    - latency_ms (Number)
    - token_count (Number)       # Estimated token usage
    - model_used (String)
    - sources_count (Number)     # Number of source documents
    - citation_count (Number)    # Number of citations in response
"""
from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone
from typing import Any

import boto3
from botocore.exceptions import ClientError
from tenacity import retry, stop_after_attempt, wait_exponential

from app.core.config import settings

log = logging.getLogger(__name__)


def _dynamodb_client() -> Any:
    """Build a boto3 DynamoDB client."""
    kwargs: dict[str, Any] = dict(
        region_name=settings.AWS_REGION,
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
    )
    if settings.AWS_ENDPOINT_URL:
        kwargs["endpoint_url"] = settings.AWS_ENDPOINT_URL
    return boto3.client("dynamodb", **kwargs)


# ── Table management ──────────────────────────────────────────────────────────
def ensure_audit_table_exists() -> None:
    """Create the audit table if it doesn't exist (idempotent)."""
    if not settings.USE_DYNAMODB:
        log.debug("DynamoDB audit logging disabled")
        return
        
    client = _dynamodb_client()
    table_name = settings.DYNAMODB_AUDIT_TABLE
    
    try:
        client.describe_table(TableName=table_name)
        log.info("DynamoDB table %r already exists", table_name)
        return
    except ClientError as e:
        if e.response["Error"]["Code"] != "ResourceNotFoundException":
            raise

    # Create table with partition key (workspace_id) and sort key (query_timestamp)
    log.info("Creating DynamoDB audit table %r", table_name)
    client.create_table(
        TableName=table_name,
        KeySchema=[
            {"AttributeName": "workspace_id", "KeyType": "HASH"},
            {"AttributeName": "query_timestamp", "KeyType": "RANGE"}
        ],
        AttributeDefinitions=[
            {"AttributeName": "workspace_id", "AttributeType": "S"},
            {"AttributeName": "query_timestamp", "AttributeType": "S"}
        ],
        BillingMode="PAY_PER_REQUEST",  # On-demand pricing
        TimeToLiveSpecification={
            "AttributeName": "expires_at",
            "Enabled": True
        }
    )
    
    # Wait for table to be created
    waiter = client.get_waiter("table_exists")
    waiter.wait(TableName=table_name, WaiterConfig={"Delay": 2, "MaxAttempts": 30})
    log.info("DynamoDB audit table %r created successfully", table_name)


# ── Audit logging ─────────────────────────────────────────────────────────────
@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=8))
def write_audit_log(
    query_log_id: str,
    workspace_id: str,
    user_id: str,
    query_text: str,
    answer_text: str,
    confidence_score: float,
    chunk_ids: list[str],
    latency_ms: int,
    model_used: str,
    sources: list[dict],
    citations: list[dict],
) -> None:
    """
    Write comprehensive audit log to DynamoDB.
    
    This supplements the PostgreSQL query_logs table with additional metadata
    for analytics and compliance purposes.
    """
    if not settings.USE_DYNAMODB:
        log.debug("DynamoDB audit logging disabled, skipping")
        return

    client = _dynamodb_client()
    now = datetime.now(timezone.utc)
    
    # Calculate TTL (7 years from now for SEC compliance)
    ttl_timestamp = int(time.time() + (settings.DYNAMODB_TTL_DAYS * 24 * 60 * 60))
    
    # Estimate token count (rough approximation)
    token_count = _estimate_token_count(query_text, answer_text)
    
    # Prepare item
    item = {
        "workspace_id": {"S": workspace_id},
        "query_timestamp": {"S": now.isoformat()},
        "expires_at": {"N": str(ttl_timestamp)},
        "query_log_id": {"S": query_log_id},
        "user_id": {"S": user_id},
        "query_text": {"S": query_text},
        "answer_text": {"S": answer_text},
        "confidence_score": {"N": str(confidence_score)},
        "chunk_ids": {"SS": chunk_ids} if chunk_ids else {"SS": []},
        "latency_ms": {"N": str(latency_ms)},
        "token_count": {"N": str(token_count)},
        "model_used": {"S": model_used},
        "sources_count": {"N": str(len(sources))},
        "citation_count": {"N": str(len(citations))},
    }
    
    # Add source document IDs if available
    doc_ids = list({s.get("document_id") for s in sources if s.get("document_id")})
    if doc_ids:
        item["source_doc_ids"] = {"SS": doc_ids}
    
    try:
        client.put_item(
            TableName=settings.DYNAMODB_AUDIT_TABLE,
            Item=item
        )
        log.debug(
            "Audit log written to DynamoDB: workspace=%s query_log_id=%s tokens=%d",
            workspace_id, query_log_id, token_count
        )
    except ClientError as e:
        log.error("Failed to write DynamoDB audit log: %s", e)
        # Don't raise - audit logging should not break the main pipeline
        

def _estimate_token_count(query_text: str, answer_text: str) -> int:
    """
    Rough token count estimation.
    
    Real implementation would use tiktoken or similar, but this gives
    a reasonable approximation for audit purposes.
    """
    # Rough approximation: 1 token ≈ 0.75 words ≈ 4 characters
    total_chars = len(query_text) + len(answer_text)
    return int(total_chars / 4)


# ── Analytics queries ─────────────────────────────────────────────────────────
def get_workspace_query_stats(workspace_id: str, days: int = 30) -> dict[str, Any]:
    """
    Get query statistics for a workspace over the last N days.
    
    Returns aggregated metrics for analytics dashboard.
    """
    if not settings.USE_DYNAMODB:
        return {"error": "DynamoDB audit logging disabled"}
    
    client = _dynamodb_client()
    
    # Calculate time range
    now = datetime.now(timezone.utc)
    start_time = datetime(now.year, now.month, now.day - days, tzinfo=timezone.utc)
    
    try:
        # Query by workspace_id with time range filter
        response = client.query(
            TableName=settings.DYNAMODB_AUDIT_TABLE,
            KeyConditionExpression="workspace_id = :wid AND query_timestamp >= :start",
            ExpressionAttributeValues={
                ":wid": {"S": workspace_id},
                ":start": {"S": start_time.isoformat()}
            },
            ProjectionExpression="confidence_score,latency_ms,token_count,sources_count,model_used"
        )
        
        items = response.get("Items", [])
        
        if not items:
            return {
                "workspace_id": workspace_id,
                "days": days,
                "total_queries": 0,
                "avg_confidence": 0.0,
                "avg_latency_ms": 0,
                "total_tokens": 0,
                "model_distribution": {}
            }
        
        # Calculate aggregated metrics
        confidences = []
        latencies = []
        tokens = []
        models = {}
        
        for item in items:
            if "confidence_score" in item:
                confidences.append(float(item["confidence_score"]["N"]))
            if "latency_ms" in item:
                latencies.append(int(item["latency_ms"]["N"]))
            if "token_count" in item:
                tokens.append(int(item["token_count"]["N"]))
            if "model_used" in item:
                model = item["model_used"]["S"]
                models[model] = models.get(model, 0) + 1
        
        return {
            "workspace_id": workspace_id,
            "days": days,
            "total_queries": len(items),
            "avg_confidence": sum(confidences) / len(confidences) if confidences else 0.0,
            "avg_latency_ms": int(sum(latencies) / len(latencies)) if latencies else 0,
            "total_tokens": sum(tokens),
            "model_distribution": models
        }
        
    except ClientError as e:
        log.error("Failed to query DynamoDB analytics: %s", e)
        return {"error": f"Query failed: {e}"}


# ── Compliance queries ────────────────────────────────────────────────────────
def get_user_query_history(
    user_id: str, 
    start_date: datetime | None = None,
    limit: int = 100
) -> list[dict[str, Any]]:
    """
    Get query history for compliance/audit purposes.
    
    Scans across all workspaces for a specific user.
    Used for regulatory compliance and user activity audits.
    """
    if not settings.USE_DYNAMODB:
        return []
    
    client = _dynamodb_client()
    
    try:
        # Use GSI if available, otherwise scan (expensive for large tables)
        scan_kwargs = {
            "TableName": settings.DYNAMODB_AUDIT_TABLE,
            "FilterExpression": "user_id = :uid",
            "ExpressionAttributeValues": {":uid": {"S": user_id}},
            "Limit": limit
        }
        
        if start_date:
            scan_kwargs["FilterExpression"] += " AND query_timestamp >= :start"
            scan_kwargs["ExpressionAttributeValues"][":start"] = {"S": start_date.isoformat()}
        
        response = client.scan(**scan_kwargs)
        
        return [_dynamodb_item_to_dict(item) for item in response.get("Items", [])]
        
    except ClientError as e:
        log.error("Failed to get user query history: %s", e)
        return []


def _dynamodb_item_to_dict(item: dict) -> dict[str, Any]:
    """Convert DynamoDB item format to regular dict."""
    result = {}
    for key, value in item.items():
        if "S" in value:
            result[key] = value["S"]
        elif "N" in value:
            result[key] = float(value["N"])
        elif "SS" in value:
            result[key] = value["SS"]
        # Add other type conversions as needed
    return result