# Quickstart: Knowledge Base Agent

**Feature**: 001-knowledge-base-agent
**Date**: 2026-02-03
**Last Updated**: 2026-02-05 (Data Model Refactor)

## Prerequisites

- AWS Account with Bedrock access enabled
- Existing deployment of Strands Agent Chatbot
- Python 3.13+ for backend development
- Node.js 18+ for frontend development

---

## Step 1: Infrastructure Setup

### Deploy CDK Stack Updates

```bash
cd agent-blueprint

# Update .env with new KB configuration (if needed)
echo "BEDROCK_KB_EMBEDDING_MODEL=amazon.titan-embed-text-v2:0" >> .env

# Deploy runtime stack with KB resources (includes new kb-catalog table)
./deploy.sh --runtime
```

### Verify Resources Created

```bash
# Check new DynamoDB table
aws dynamodb describe-table --table-name strands-agent-chatbot-kb-catalog

# Check S3 bucket
aws s3 ls | grep kb-docs

# Check IAM permissions (in CloudFormation outputs)
aws cloudformation describe-stacks \
  --stack-name strands-agent-chatbot-runtime \
  --query 'Stacks[0].Outputs'
```

**New resources created:**
- DynamoDB table: `{project}-kb-catalog` with GSI `user_id-index`
- S3 bucket: `{project}-kb-docs-{account}-{region}`
- S3 Vector Bucket: `{project}-kb-vectors`
- Bedrock Knowledge Base: Shared KB with S3 Vector storage

---

## Step 2: Backend Tool Implementation

### Existing Implementation

The `KBCatalogManager` class is already implemented in:
```
chatbot-app/agentcore/src/workspace/kb_catalog_manager.py
```

### Update for New Table Schema

The key change is updating the table name and key patterns:

```python
# chatbot-app/agentcore/src/workspace/kb_catalog_manager.py

# OLD (users-v2 style):
# self.table_name = f"{self.project_name}-users-v2"
# Key={"userId": self.user_id, "sk": f"CATALOG#{catalog_id}"}

# NEW (dedicated table):
self.table_name = f"{self.project_name}-kb-catalog"

# Get catalog
response = self.table.get_item(
    Key={"catalog_id": catalog_id, "sk": "METADATA"}
)

# List documents in catalog
response = self.table.query(
    KeyConditionExpression='catalog_id = :cid AND begins_with(sk, :prefix)',
    ExpressionAttributeValues={
        ':cid': catalog_id,
        ':prefix': 'DOC#'
    }
)

# List user's catalogs (via GSI)
response = self.table.query(
    IndexName='user_id-index',
    KeyConditionExpression='user_id = :uid',
    ExpressionAttributeValues={':uid': self.user_id}
)
```

### Register Tool

```python
# chatbot-app/agentcore/src/builtin_tools/__init__.py

# Add import
from .knowledge_base_tools import (
    list_catalogs,
    create_catalog,
    # ... other tools
)

# Add to __all__
__all__ = [
    # ... existing tools
    'list_catalogs',
    'create_catalog',
    # ... other KB tools
]
```

---

## Step 3: Frontend Configuration

### Add Tool Config

```json
// chatbot-app/frontend/src/config/tools-config.json
// Add to "builtin_tools" array:

{
  "id": "knowledge_base_tools",
  "name": "Knowledge Base",
  "description": "Create and query personal document catalogs",
  "category": "knowledge",
  "icon": "library_books",
  "enabled": true,
  "isDynamic": true,
  "tools": [
    {"id": "list_catalogs", "name": "List Catalogs"},
    {"id": "create_catalog", "name": "Create Catalog"}
  ]
}
```

### Sync Tool Registry

```bash
# Start frontend dev server
cd chatbot-app/frontend
npm run dev

# In another terminal, sync registry
curl -X POST http://localhost:3000/api/tools/sync-registry
```

---

## Step 4: Local Testing

### Start Development Environment

```bash
cd chatbot-app
./start.sh
```

### Test via Chat Interface

1. Open http://localhost:3000
2. Enable "Knowledge Base" tools in the tools dropdown
3. Test with prompts:
   - "List my knowledge base catalogs"
   - "Create a catalog called 'Test Research'"

### Test via API

```bash
# Direct tool invocation test
curl -X POST http://localhost:8080/invocations \
  -H "Content-Type: application/json" \
  -d '{
    "message": "List my knowledge base catalogs",
    "user_id": "test-user",
    "session_id": "test-session",
    "enabled_tools": ["list_catalogs"]
  }'
```

---

## Step 5: Verify End-to-End

### Create Catalog

```
User: Create a knowledge base catalog called "Project Docs"
Agent: Created catalog 'Project Docs' (ID: cat-abc123)
```

### Upload Document

```
User: Upload this PDF to my Project Docs catalog
[Attach file]
Agent: Uploaded 'report.pdf' to 'Project Docs'. Indexing started.
```

### Query Catalog

```
User: What are the key findings in my Project Docs?
Agent: Based on your documents...
[Response with citations]
```

---

## Common Issues

### Tool Not Appearing

1. Check `__init__.py` exports the tool
2. Verify `tools-config.json` includes the tool ID
3. Restart the backend server
4. Sync the tool registry

### DynamoDB Access Denied

1. Check IAM role has `dynamodb:Query`, `dynamodb:GetItem` permissions
2. Verify table name matches `{PROJECT_NAME}-kb-catalog`
3. Verify GSI permissions for `user_id-index`
4. Check CloudWatch logs for detailed error

### Bedrock KB Query Fails

1. Verify KB is created and has data source
2. Check ingestion job completed successfully
3. Ensure metadata filters match exactly
4. Check Bedrock service quotas

---

## Data Model Quick Reference

### Table: `{project}-kb-catalog`

| Key | Value | Description |
|-----|-------|-------------|
| `catalog_id` | `cat-xxxxx` | Partition key |
| `sk` | `METADATA` | Catalog metadata record |
| `sk` | `DOC#{doc_id}` | Document record |

### GSI: `user_id-index`

- Partition key: `user_id`
- Projection: KEYS_ONLY
- Use for: Listing all catalogs owned by a user

### Access Patterns

```python
# Get catalog
table.get_item(Key={"catalog_id": cid, "sk": "METADATA"})

# List documents
table.query(PK=catalog_id, SK begins_with "DOC#")

# List user's catalogs
table.query(IndexName="user_id-index", PK=user_id)
```

---

## Next Steps

1. Implement remaining tools (upload, delete, query)
2. Add frontend file upload UI for catalogs
3. Implement indexing status polling
4. Add integration tests
5. Deploy to cloud environment
