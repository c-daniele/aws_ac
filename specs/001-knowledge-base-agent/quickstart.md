# Quickstart: Knowledge Base Agent

**Feature**: 001-knowledge-base-agent
**Date**: 2026-02-03

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

# Deploy runtime stack with KB resources
./deploy.sh --runtime
```

### Verify Resources Created

```bash
# Check S3 bucket
aws s3 ls | grep kb-docs

# Check IAM permissions (in CloudFormation outputs)
aws cloudformation describe-stacks \
  --stack-name strands-agent-chatbot-runtime \
  --query 'Stacks[0].Outputs'
```

---

## Step 2: Backend Tool Implementation

### Create Tool File

```bash
# Create new tool file
touch chatbot-app/agentcore/src/builtin_tools/knowledge_base_tools.py
```

### Implement Basic Tool

```python
# chatbot-app/agentcore/src/builtin_tools/knowledge_base_tools.py

import logging
import boto3
from typing import Dict, Any, Optional
from strands import tool, ToolContext

logger = logging.getLogger(__name__)

def _get_user_session_ids(tool_context: ToolContext) -> tuple[str, str]:
    """Extract user_id and session_id from ToolContext"""
    invocation_state = tool_context.invocation_state
    return (
        invocation_state.get('user_id', 'default_user'),
        invocation_state.get('session_id', 'default_session')
    )

@tool(context=True)
def list_catalogs(tool_context: ToolContext = None) -> Dict[str, Any]:
    """List all knowledge base catalogs for the current user.

    Returns:
        List of catalogs with metadata
    """
    try:
        user_id, _ = _get_user_session_ids(tool_context)

        # Query DynamoDB for user's catalogs
        dynamodb = boto3.resource('dynamodb')
        table = dynamodb.Table(f"{os.environ['PROJECT_NAME']}-users-v2")

        response = table.query(
            KeyConditionExpression='userId = :uid AND begins_with(sk, :prefix)',
            ExpressionAttributeValues={
                ':uid': user_id,
                ':prefix': 'CATALOG#'
            }
        )

        catalogs = response.get('Items', [])

        if not catalogs:
            return {
                "content": [{"text": "No catalogs found. Create one with create_catalog."}],
                "status": "success",
                "metadata": {"catalog_count": 0}
            }

        # Format response
        lines = [f"Found {len(catalogs)} catalog(s):\n"]
        for cat in catalogs:
            lines.append(f"- **{cat['catalog_name']}** ({cat['catalog_id']})")
            lines.append(f"  {cat.get('document_count', 0)} documents, Status: {cat.get('indexing_status', 'unknown')}")

        return {
            "content": [{"text": "\n".join(lines)}],
            "status": "success",
            "metadata": {"catalog_count": len(catalogs), "catalogs": catalogs}
        }

    except Exception as e:
        logger.error(f"list_catalogs failed: {e}")
        return {
            "content": [{"text": f"Error listing catalogs: {str(e)}"}],
            "status": "error"
        }
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
  "icon": "📚",
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

1. Check IAM role has `dynamodb:Query` permission
2. Verify table name matches `PROJECT_NAME-users-v2`
3. Check CloudWatch logs for detailed error

### Bedrock KB Query Fails

1. Verify KB is created and has data source
2. Check ingestion job completed successfully
3. Ensure metadata filters match exactly
4. Check Bedrock service quotas

---

## Next Steps

1. Implement remaining tools (upload, delete, query)
2. Add frontend file upload UI for catalogs
3. Implement indexing status polling
4. Add integration tests
5. Deploy to cloud environment
