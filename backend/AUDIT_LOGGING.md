# Comprehensive Audit Logging

This implementation provides comprehensive audit logging for regulatory compliance and analytics, combining PostgreSQL and DynamoDB storage.

## Architecture

### Dual-Layer Logging
1. **PostgreSQL** (Required): Primary audit trail in `query_logs` table
2. **DynamoDB** (Optional): Enhanced audit with analytics metadata

### Data Flow
```
RAG Query → Pipeline → PostgreSQL (immediate) → DynamoDB (async) → Analytics
```

## Features Implemented

### Day 5-7: Comprehensive Audit Logging

#### PostgreSQL Audit Trail
- **Table**: `query_logs` (existing, SEC 17a-4 compliant)
- **Data**: Every query, response, confidence, chunk IDs, latency, model used
- **Compliance**: Immutable records, never UPDATE/DELETE

#### DynamoDB Enhanced Audit
- **Table**: `finsight-query-audit`
- **Partition Key**: `workspace_id` 
- **Sort Key**: `query_timestamp`
- **TTL**: 7 years (SEC compliance)
- **Enhanced Data**: Token count, source count, citation count, detailed metadata

#### Analytics Summary Table
- **Table**: `analytics_summary` (PostgreSQL)
- **Purpose**: Pre-calculated metrics for fast dashboard queries
- **Data**: Source counts, citation counts, unique documents, average scores

## Configuration

### Environment Variables
```bash
# Enable DynamoDB audit logging
USE_DYNAMODB=true
DYNAMODB_AUDIT_TABLE=finsight-query-audit
DYNAMODB_TTL_DAYS=2555  # 7 years

# AWS credentials (works with LocalStack)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-key
AWS_SECRET_ACCESS_KEY=your-secret
AWS_ENDPOINT_URL=http://localhost:4566  # For LocalStack
```

## API Endpoints

### Workspace Analytics
```http
GET /api/v1/analytics/audit/workspace/{workspace_id}?days=30
```
Returns comprehensive analytics combining PostgreSQL and DynamoDB data.

### User Audit Trail (Compliance)
```http
GET /api/v1/analytics/audit/user/{user_id}?start_date=2024-01-01&limit=100
```
Returns complete user activity for regulatory audits.

### Token Usage Analytics
```http
POST /api/v1/analytics/audit/token-usage
Content-Type: application/json

{
  "workspace_ids": ["ws-123", "ws-456"],
  "days": 30
}
```
Returns token consumption and cost estimates.

## Data Schema

### DynamoDB Item Structure
```json
{
  "workspace_id": "ws-abc123",
  "query_timestamp": "2024-12-20T10:30:45.123Z",
  "query_log_id": "log-xyz789",
  "user_id": "user-456",
  "query_text": "What was the revenue growth?",
  "answer_text": "Revenue grew 12% to $383B [1]",
  "confidence_score": 0.94,
  "chunk_ids": ["chunk-1", "chunk-2"],
  "latency_ms": 1247,
  "token_count": 842,
  "model_used": "llama-3.1-70b-versatile",
  "sources_count": 3,
  "citation_count": 1,
  "source_doc_ids": ["doc-abc", "doc-def"],
  "expires_at": 1893456000
}
```

### PostgreSQL Analytics Summary
```sql
CREATE TABLE analytics_summary (
    id VARCHAR(36) PRIMARY KEY,
    query_log_id VARCHAR(36) REFERENCES query_logs(id),
    workspace_id VARCHAR(36) REFERENCES workspaces(id),
    source_count INTEGER NOT NULL DEFAULT 0,
    citation_count INTEGER NOT NULL DEFAULT 0,
    unique_documents INTEGER NOT NULL DEFAULT 0,
    avg_source_score FLOAT NOT NULL DEFAULT 0.0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL
);
```

## Usage Examples

### Enable DynamoDB Logging
```python
# In .env file
USE_DYNAMODB=true

# Application will automatically:
# 1. Create DynamoDB table on startup
# 2. Log every query to both PostgreSQL and DynamoDB
# 3. Enable advanced analytics endpoints
```

### Query Workspace Analytics
```python
import httpx

response = httpx.get(
    "http://localhost:8000/api/v1/analytics/audit/workspace/ws-123?days=7",
    headers={"Authorization": "Bearer your-jwt-token"}
)

analytics = response.json()
print(f"Total queries: {analytics['analytics']['dynamodb']['total_queries']}")
print(f"Avg confidence: {analytics['analytics']['dynamodb']['avg_confidence']}")
```

### Compliance Audit Trail
```python
# Get user's complete query history
response = httpx.get(
    "http://localhost:8000/api/v1/analytics/audit/user/user-123",
    headers={"Authorization": "Bearer admin-jwt-token"}
)

audit_trail = response.json()
print(f"Total audit entries: {audit_trail['audit_trail']['total_entries']}")
```

## Compliance Features

### SEC Rule 17a-4 Compliance
- **Immutable Records**: Query logs never modified or deleted
- **7-Year Retention**: DynamoDB TTL set to 2555 days
- **Complete Trail**: Every query, response, and metadata logged
- **Tamper Resistance**: DynamoDB provides inherent immutability

### Analytics for Oversight
- **Token Usage Tracking**: Monitor AI service costs
- **Confidence Trends**: Track answer quality over time
- **User Activity**: Complete audit trail per user
- **Model Performance**: Track which models perform best

## Development & Testing

### LocalStack Setup
```bash
# Start LocalStack with DynamoDB
docker run -d -p 4566:4566 localstack/localstack

# Set endpoint URL for local development
export AWS_ENDPOINT_URL=http://localhost:4566
```

### Manual Testing
```bash
# Create test query
curl -X POST http://localhost:8000/api/v1/queries \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-jwt" \
  -d '{"query": "Test query", "workspace_id": "ws-test"}'

# Check audit logs
curl http://localhost:8000/api/v1/analytics/audit/workspace/ws-test \
  -H "Authorization: Bearer your-jwt"
```

## Performance Considerations

### DynamoDB Partitioning
- Partition by `workspace_id` for even distribution
- Sort by `query_timestamp` for time-range queries
- On-demand billing scales automatically

### PostgreSQL Optimization
- Indexes on `workspace_id`, `user_id`, `created_at`
- Analytics summary table reduces query load
- Archive old logs based on retention policy

### Cost Optimization
- DynamoDB TTL automatically deletes old records
- Use projection expressions to reduce read costs
- Consider reserved capacity for predictable workloads

## Monitoring

The enhanced analytics provide visibility into:
- Query volume trends
- Model performance metrics
- Token consumption patterns
- User engagement analytics
- Confidence score distributions
- Source document utilization

This audit logging implementation ensures regulatory compliance while providing rich analytics for operational insights.