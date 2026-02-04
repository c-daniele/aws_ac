# Implementation Plan: Knowledge Base Agent

**Branch**: `001-knowledge-base-agent` | **Date**: 2026-02-03 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/001-knowledge-base-agent/spec.md`

## Summary

Implement a Knowledge Base Agent that enables users to create, manage, and query personal document catalogs using AWS Bedrock Knowledge Base. The solution uses a single shared Knowledge Base with metadata filtering (user_id, catalog_id) for multi-tenant isolation. Documents are stored in S3 with companion metadata files, and catalog metadata is stored in the existing DynamoDB users table using composite sort keys.

---

## Technical Context

**Language/Version**: Python 3.13 (backend), TypeScript (frontend, CDK)
**Primary Dependencies**: Strands Agents SDK, FastAPI, boto3, AWS CDK v2
**Storage**: DynamoDB (catalog metadata), S3 (documents), Bedrock KB + S3 Vector Bucket (vectors)
**Testing**: Manual validation (per constitution - automated tests to be added later)
**Target Platform**: AWS (ECS Fargate, Bedrock, S3, DynamoDB)
**Project Type**: Web application (frontend + backend + infrastructure)
**Performance Goals**: RAG queries < 5s, indexing < 5 min for 10MB files
**Constraints**: 50MB max file size, multi-tenant isolation required
**Scale/Scope**: Tens of catalogs per user, hundreds of documents per catalog

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Serverless-First | ✅ PASS | Uses Bedrock KB (managed), DynamoDB, S3 |
| II. Multi-Agent Architecture | ✅ PASS | Tools use Strands @tool decorator with ToolContext |
| III. Infrastructure as Code | ✅ PASS | All resources defined in CDK stacks |
| IV. Full-Stack Consistency | ✅ PASS | Tool contracts defined, frontend config matches backend |
| V. Simplicity & Maintainability | ✅ PASS | Extends existing patterns, no new abstractions |

**Post-Design Re-Check**: All principles validated. Implementation follows existing codebase patterns.

---

## Project Structure

### Documentation (this feature)

```text
specs/001-knowledge-base-agent/
├── spec.md              # Feature specification
├── plan.md              # This file
├── research.md          # Technical research findings
├── data-model.md        # Entity definitions and schemas
├── quickstart.md        # Development quickstart guide
├── contracts/           # API contracts
│   └── tools-api.md     # Tool signatures and responses
└── checklists/
    └── requirements.md  # Specification quality checklist
```

### Source Code (repository root)

```text
chatbot-app/
├── agentcore/
│   └── src/
│       ├── builtin_tools/
│       │   ├── __init__.py                    # Export KB tools
│       │   └── knowledge_base_tools.py        # NEW: 9 KB tools
│       └── workspace/
│           └── kb_catalog_manager.py          # NEW: S3/DynamoDB manager
└── frontend/
    └── src/
        └── config/
            └── tools-config.json              # MODIFY: Add KB tools

agent-blueprint/
└── agentcore-runtime-stack/
    └── lib/
        └── agent-runtime-stack.ts             # MODIFY: Add KB S3 bucket, IAM
```

**Structure Decision**: Follows existing web application pattern with backend tools in `builtin_tools/`, shared manager in `workspace/`, frontend config in `config/`, and infrastructure in CDK stacks.

---

## Implementation Phases

### Phase 1: Infrastructure (CDK)

**Files to modify**:
- `agent-blueprint/agentcore-runtime-stack/lib/agent-runtime-stack.ts`

**Changes**:
1. Add S3 bucket for KB documents: `{project}-kb-docs-{account}-{region}`
2. Add S3 Vector Bucket: `{project}-kb-vectors`
3. Add S3 Vector Index (float32, 1024 dimensions, cosine)
4. Add single shared Bedrock Knowledge Base (no default data source - created per catalog)
5. Add IAM role for Bedrock KB service
6. Add IAM permissions for application (query, retrieve, ingest, create/delete data sources)
7. Add environment variables: KB_ID, KB_DOCS_BUCKET

### Phase 2: Backend Tools

**Files to create**:
- `chatbot-app/agentcore/src/builtin_tools/knowledge_base_tools.py`
- `chatbot-app/agentcore/src/workspace/kb_catalog_manager.py`

**Files to modify**:
- `chatbot-app/agentcore/src/builtin_tools/__init__.py`

**Tools to implement** (in priority order):
1. `create_catalog` - Create new catalog (DynamoDB)
2. `list_catalogs` - List user's catalogs
3. `upload_to_catalog` - Upload document to S3 + metadata
4. `list_catalog_documents` - List documents in catalog
5. `select_catalog` - Set active catalog for session
6. `query_catalog` - RAG query via Bedrock
7. `get_indexing_status` - Check ingestion progress
8. `delete_catalog_document` - Delete document + trigger re-sync
9. `delete_catalog` - Cascade delete catalog

### Phase 3: Frontend Configuration

**Files to modify**:
- `chatbot-app/frontend/src/config/tools-config.json`

**Changes**:
1. Add `knowledge_base_tools` group with all 9 tools
2. Add system prompt guidance for KB usage
3. Configure display names for tool states

### Phase 4: Verification & Testing

**Post-deployment verification**:
1. Verify KB created via CDK (check AWS Console or `aws bedrock-agent list-knowledge-bases`)
2. Verify S3 Vector Bucket and Index created
3. Verify environment variables set correctly on ECS task
4. Run integration tests for multi-tenant isolation

---

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Vector store | Single shared KB with metadata filtering | Cost-effective, simpler than per-user KBs |
| Metadata storage | Existing users-v2 table with composite SK | Reuses existing pattern, no new table |
| Document storage | Dedicated S3 bucket with metadata.json files | Required by Bedrock KB for metadata injection |
| Tool registration | builtin_tools pattern | Consistent with existing document tools |
| Indexing trigger | Manual sync after uploads | Simpler than event-driven, acceptable latency |

---

## Verification Plan

### Local Development Testing

1. Start dev environment: `cd chatbot-app && ./start.sh`
2. Enable KB tools in frontend dropdown
3. Test tool sequence:
   - Create catalog: "Create a catalog called 'Test Research'"
   - List catalogs: "Show my catalogs"
   - Upload: Attach file, "Upload this to Test Research"
   - Query: "What does my document say about X?"
   - Delete: "Remove the document I just uploaded"

### Integration Testing

```bash
cd scripts
python test_knowledge_base.py  # To be created
```

Test cases:
- Catalog CRUD operations
- Document upload with various file types
- Multi-tenant isolation (user A cannot see user B's catalogs)
- RAG query with citations
- Indexing status polling

### Cloud Deployment Testing

1. Deploy updated stacks: `cd agent-blueprint && ./deploy.sh --runtime`
2. Verify S3 bucket created with correct permissions
3. Test via deployed frontend URL
4. Check CloudWatch logs for errors

---

## Complexity Tracking

> No constitution violations requiring justification.

| Aspect | Complexity Level | Notes |
|--------|-----------------|-------|
| New infrastructure | Low | Single S3 bucket + IAM permissions |
| Backend tools | Medium | 9 tools, follows existing patterns |
| Frontend changes | Low | Config file update only |
| Bedrock integration | Medium | New AWS service, but managed |

---

## References

- [research.md](research.md) - Technical research findings
- [data-model.md](data-model.md) - Entity definitions
- [contracts/tools-api.md](contracts/tools-api.md) - Tool API contracts
- [quickstart.md](quickstart.md) - Development quickstart
