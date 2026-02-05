# Implementation Plan: Knowledge Base Agent - Data Model Refactor

**Branch**: `001-knowledge-base-agent` | **Date**: 2026-02-05 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-knowledge-base-agent/spec.md`

## Summary

Refactor the Knowledge Base Catalog data model from the existing `{project}-users-v2` DynamoDB table to a new dedicated `{project}-kb-catalog` table. This change improves separation of concerns, enables independent scaling, and provides clearer access patterns for Catalog and Document entities. The feature is not yet in production, so no data migration is required.

## Technical Context

**Language/Version**: Python 3.13 (backend), TypeScript (CDK infrastructure)  
**Primary Dependencies**: FastAPI, Strands Agents SDK, boto3, AWS CDK v2  
**Storage**: DynamoDB (`{project}-kb-catalog` - new table), S3 (document files), Bedrock KB (vectors)  
**Testing**: pytest (backend), integration tests in `scripts/`  
**Target Platform**: AWS (ECS Fargate, Lambda, DynamoDB, S3, Bedrock)
**Project Type**: Web application (frontend + backend)  
**Performance Goals**: Catalog creation <2min, RAG queries <5s, indexing <5min for 10MB files (from SC-001/002/003)  
**Constraints**: User isolation required (0% cross-tenant leakage), 50MB max file size, on-demand DynamoDB  
**Scale/Scope**: Tens of catalogs per user, up to 500 documents per catalog, ~100 documents for <5s query

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The constitution template contains placeholder principles. Applying reasonable defaults:

| Principle | Status | Notes |
|-----------|--------|-------|
| Separation of Concerns | PASS | Dedicated table improves modularity |
| Test-First | PASS | Unit tests exist, will add integration tests |
| Observability | PASS | CloudWatch logs, DynamoDB metrics available |
| Simplicity | PASS | Single table for catalog domain, clear access patterns |

**Gate Result**: PASS - No violations requiring justification.

## Project Structure

### Documentation (this feature)

```text
specs/001-knowledge-base-agent/
├── plan.md              # This file
├── research.md          # Phase 0 output - DynamoDB patterns research
├── data-model.md        # Phase 1 output - Entity definitions
├── quickstart.md        # Phase 1 output - Developer setup guide
├── contracts/           # Phase 1 output - API schemas
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

```text
# Existing structure - changes marked with [MODIFY] or [NEW]

agent-blueprint/
└── agentcore-runtime-stack/
    └── lib/
        └── agent-runtime-stack.ts    # [MODIFY] Add DynamoDB table + GSI

chatbot-app/
├── agentcore/
│   └── src/
│       └── workspace/
│           └── kb_catalog_manager.py  # [MODIFY] Use new table, new key schema
└── frontend/
    └── src/
        └── lib/
            └── dynamodb-schema.ts     # [NO CHANGE] - kb-catalog is separate
```

**Structure Decision**: Modifying existing files only. No new directories needed - the change is isolated to:
1. CDK stack (add table definition)
2. Python manager class (update table name and key patterns)

## Complexity Tracking

> No violations requiring justification. Design follows established patterns.
