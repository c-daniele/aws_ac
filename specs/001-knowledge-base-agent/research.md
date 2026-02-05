# Research: Knowledge Base Agent

**Feature**: 001-knowledge-base-agent
**Date**: 2026-02-03
**Last Updated**: 2026-02-05 (Data Model Refactor)
**Status**: Complete

## Executive Summary

This research consolidates findings on implementing a Knowledge Base Agent for the Strands Agent Chatbot. The feature enables users to create, manage, and query personal document catalogs using AWS Bedrock Knowledge Base with S3 Vector Bucket storage. A single shared Knowledge Base serves all users, with metadata filtering (user_id, catalog_id) for multi-tenant isolation.

**UPDATE 2026-02-05**: The data model has been refactored to use a dedicated `{project}-kb-catalog` DynamoDB table instead of extending the `users-v2` table. This improves separation of concerns, enables independent scaling, and provides clearer access patterns.

---

## Decision 1: Vector Store Architecture

**Decision**: Use a single shared Bedrock Knowledge Base with S3 Vector Bucket (AWS::S3Vectors::VectorBucket) and metadata filtering for multi-tenant isolation.

**Rationale**:
- AWS account limits constrain the number of Knowledge Bases per account
- Single KB + single S3 Vector Bucket + single Index is the recommended architecture per AWS documentation
- S3 Vector Bucket is the latest AWS vector storage solution (serverless-first)
- Metadata filtering (user_id, catalog_id) provides tenant isolation at query time
- Simpler infrastructure: no dynamic KB creation/deletion needed
- Cost-effective for the expected scale

**Implementation**:
- Single shared Bedrock KB created at deployment time (infrastructure)
- Single S3 Vector Bucket and Index for all vectors
- **One data source per catalog** - each pointing to `s3://{bucket}/{user_id}/{catalog_id}/`
- This enables concurrent ingestion jobs since each catalog has its own data source
- Metadata fields (user_id, catalog_id, filename) enable filtering at query time
- Vector index: float32, 1024 dimensions, cosine distance metric

**Alternatives Considered**:
| Alternative | Rejected Because |
|-------------|------------------|
| OpenSearch Serverless | Not using S3 Vector Bucket as required |
| 1:1 Catalog-to-KB mapping | AWS account limits on KB count, increased complexity |
| External vector DB (Pinecone) | Additional vendor, not serverless-first |

---

## Decision 2: Metadata Storage (UPDATED 2026-02-05)

**Decision**: Use a dedicated `{project}-kb-catalog` DynamoDB table with `catalog_id` as partition key.

**Rationale**:
- Clean separation from user/session data in `users-v2` table
- Independent scaling and capacity planning
- Clearer access patterns optimized for catalog operations
- Simpler IAM policies (separate resource ARN)
- Most common access is "get catalog with its documents" (single partition query)

**Key Schema**:
```
Table: {project}-kb-catalog
PK: catalog_id (String)
SK: METADATA | DOC#{document_id}
GSI: user_id-index (PK: user_id) for listing user's catalogs
Billing: On-demand (PAY_PER_REQUEST)
```

**Access Patterns**:
| Pattern | Key Condition | Notes |
|---------|---------------|-------|
| Get catalog | `PK=catalog_id, SK=METADATA` | Direct lookup |
| List catalog documents | `PK=catalog_id, SK begins_with DOC#` | Single partition query |
| List user's catalogs | GSI: `user_id=X` | Returns catalog_ids, then GetItem for details |

**Alternatives Considered**:
| Alternative | Rejected Because |
|-------------|------------------|
| Extend `users-v2` table | Table bloat, mixed access patterns, compromises readability |
| `user_id` as PK | Creates hot partitions, doesn't optimize for catalog-centric access |
| Two tables (catalogs + documents) | Over-engineering; documents always accessed via catalog |

---

## Decision 3: Document Storage Structure

**Decision**: New S3 bucket with path structure: `{userId}/{catalogId}/documents/` and companion `.metadata.json` files.

**Rationale**:
- Bedrock KB requires `.metadata.json` files alongside documents for custom metadata
- Path-based isolation provides clear organization
- Separate bucket from existing document workspace (different lifecycle)
- Metadata files enable filtering by user_id, catalog_id, filename

**S3 Structure**:
```
s3://{project}-kb-docs-{account}-{region}/
└── {user_id}/
    └── {catalog_id}/
        ├── report.pdf
        ├── report.pdf.metadata.json
        ├── notes.docx
        └── notes.docx.metadata.json
```

**Metadata File Format**:
```json
{
  "user_id": "cognito-user-123",
  "catalog_id": "cat-abc123",
  "filename": "report.pdf",
  "uploaded_at": "2026-02-03T10:30:00Z"
}
```

---

## Decision 4: Tool Implementation Pattern

**Decision**: Create tools as builtin_tools following existing patterns (word_document_tool, excel_spreadsheet_tool).

**Rationale**:
- Consistent with existing codebase patterns
- Uses `@tool(context=True)` decorator for user_id/session_id access
- Tools registered automatically via `__all__` export
- Frontend configuration via tools-config.json

**Tools to Implement**:
| Tool | Purpose | Pattern Reference |
|------|---------|-------------------|
| `create_catalog` | Create new catalog | Similar to document creation tools |
| `list_catalogs` | List user's catalogs | Similar to list_my_word_documents |
| `upload_to_catalog` | Upload document | Similar to save_to_s3 pattern |
| `list_catalog_documents` | List documents in catalog | Similar to list_s3_documents |
| `delete_catalog_document` | Delete document + vectors | Custom (trigger KB sync) |
| `select_catalog` | Set active catalog for session | Session state management |
| `query_catalog` | RAG query with citations | Bedrock retrieve_and_generate |
| `delete_catalog` | Remove catalog entirely | Cascade delete pattern |
| `get_indexing_status` | Check ingestion progress | Bedrock get_ingestion_job |

---

## Decision 5: Bedrock Knowledge Base Integration

**Decision**: Use a single shared Bedrock Knowledge Base with **one data source per catalog**, Amazon Titan embeddings, and S3 Vector Bucket storage. Multi-tenant isolation via metadata filtering at query time. Each catalog's data source points to its dedicated S3 path, enabling concurrent ingestion.

**Rationale**:
- Managed service (serverless-first principle)
- Native AWS integration (no external vendors)
- Titan embeddings are cost-effective and performant (amazon.titan-embed-text-v2:0)
- S3 Vector Bucket provides serverless vector storage
- Single shared KB avoids AWS account limits on KB count
- Metadata filtering (user_id, catalog_id) provides tenant isolation

**Key APIs**:
```python
# boto3 clients needed
bedrock_agent = boto3.client('bedrock-agent')      # KB management
bedrock_runtime = boto3.client('bedrock-agent-runtime')  # Queries

# KB is created at deployment time (CDK)
# Application retrieves KB_ID from environment variable
# Data sources are created dynamically per catalog

# Create data source when catalog is created
bedrock_agent.create_data_source(
    knowledgeBaseId=os.environ['KB_ID'],
    name=f'{user_id}-{catalog_id}',
    dataSourceConfiguration={
        'type': 'S3',
        's3Configuration': {
            'bucketArn': f'arn:aws:s3:::{os.environ["KB_DOCS_BUCKET"]}',
            'inclusionPrefixes': [f'{user_id}/{catalog_id}/']
        }
    }
)

# Trigger ingestion for a specific catalog's data source
bedrock_agent.start_ingestion_job(
    knowledgeBaseId=os.environ['KB_ID'],
    dataSourceId=catalog_data_source_id  # Stored in DynamoDB with catalog
)

# Query shared KB with metadata filtering
bedrock_runtime.retrieve(
    knowledgeBaseId=os.environ['KB_ID'],
    retrievalQuery={'text': query},
    retrievalConfiguration={
        'vectorSearchConfiguration': {
            'filter': {
                'andAll': [
                    {'equals': {'key': 'user_id', 'value': user_id}},
                    {'equals': {'key': 'catalog_id', 'value': catalog_id}}
                ]
            }
        }
    }
)

# For RAG with generation
bedrock_runtime.retrieve_and_generate(
    input={'text': query},
    retrieveAndGenerateConfiguration={
        'type': 'KNOWLEDGE_BASE',
        'knowledgeBaseConfiguration': {
            'knowledgeBaseId': os.environ['KB_ID'],
            'modelArn': 'arn:aws:bedrock:region::foundation-model/anthropic.claude-3-sonnet',
            'retrievalConfiguration': {
                'vectorSearchConfiguration': {
                    'filter': {
                        'andAll': [
                            {'equals': {'key': 'user_id', 'value': user_id}},
                            {'equals': {'key': 'catalog_id', 'value': catalog_id}}
                        ]
                    }
                }
            }
        }
    }
)
```

---

## Decision 6: Indexing Status Tracking

**Decision**: Track indexing status in DynamoDB with polling from Bedrock ingestion jobs.

**Rationale**:
- Bedrock ingestion jobs provide status via API
- DynamoDB stores per-document status for UI display
- Async pattern (upload → pending → indexing → indexed/failed)

**Status Flow**:
```
uploading → pending → indexing → indexed
                  ↓
                failed (with retry option)
```

**Implementation**:
1. Upload document to S3 → status: `uploading`
2. Create metadata.json → status: `pending`
3. Trigger ingestion job → status: `indexing`
4. Poll job status → status: `indexed` or `failed`

---

## Decision 7: CDK Infrastructure Additions (UPDATED 2026-02-05)

**Decision**: Add new resources to `agentcore-runtime-stack`:
- **NEW: DynamoDB table `{project}-kb-catalog`** with GSI for user queries
- S3 bucket for KB source documents where users will upload files under `{userId}/{catalogId}/`
- S3 Vector Bucket for embeddings (single shared bucket)
- S3 Vector Index (single shared index)
- Single shared Bedrock Knowledge Base
- Bedrock data sources created dynamically per catalog (enables concurrent ingestion)
- IAM role for Bedrock KB service
- IAM permissions for application to query KB and trigger ingestion
- Environment variables for KB configuration

**New DynamoDB Table** (added 2026-02-05):
```typescript
// DynamoDB table for KB Catalog metadata
const kbCatalogTable = new dynamodb.Table(this, 'KBCatalogTable', {
  tableName: `${projectName}-kb-catalog`,
  partitionKey: { name: 'catalog_id', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  removalPolicy: cdk.RemovalPolicy.RETAIN,
  pointInTimeRecovery: true,
});

// GSI for listing catalogs by user
kbCatalogTable.addGlobalSecondaryIndex({
  indexName: 'user_id-index',
  partitionKey: { name: 'user_id', type: dynamodb.AttributeType.STRING },
  projectionType: dynamodb.ProjectionType.KEYS_ONLY,
});
```

**Other Resources** (based on reference CloudFormation template):
```typescript
// S3 Vector Bucket for KB embeddings (single shared)
const kbVectorBucket = new s3vectors.CfnVectorBucket(this, 'KBVectorBucket', {
  vectorBucketName: `${projectName}-kb-vectors`
});

// S3 Vector Index (single shared)
const kbVectorIndex = new s3vectors.CfnIndex(this, 'KBVectorIndex', {
  dataType: 'float32',
  dimension: 1024,
  distanceMetric: 'cosine',
  indexName: `${projectName}-kb-vector-index`,
  vectorBucketArn: kbVectorBucket.attrVectorBucketArn,
  metadataConfiguration: {
    nonFilterableMetadataKeys: [
      'x-amz-bedrock-kb-source-uri',
      'x-amz-bedrock-kb-chunk-id',
      'x-amz-bedrock-kb-data-source-id',
      'AMAZON_BEDROCK_TEXT',
      'AMAZON_BEDROCK_METADATA'
    ]
  }
});

// S3 Bucket for KB source documents
const kbDocumentsBucket = new s3.Bucket(this, 'KBDocumentsBucket', {
  bucketName: `${projectName}-kb-docs`,
  removalPolicy: cdk.RemovalPolicy.RETAIN,
  versioned: true,
  cors: [/* browser upload config */]
});

// IAM Role for Bedrock KB Service
const bedrockKBServiceRole = new iam.Role(this, 'BedrockKBServiceRole', {
  assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
  // Policies for S3, S3Vectors, and Bedrock model access
});

// IAM for DynamoDB access (NEW)
executionRole.addToPolicy(new iam.PolicyStatement({
  actions: [
    'dynamodb:GetItem',
    'dynamodb:PutItem',
    'dynamodb:UpdateItem',
    'dynamodb:DeleteItem',
    'dynamodb:Query'
  ],
  resources: [
    kbCatalogTable.tableArn,
    `${kbCatalogTable.tableArn}/index/*`
  ]
}));

// IAM for application to use shared KB and manage data sources per catalog
executionRole.addToPolicy(new iam.PolicyStatement({
  actions: [
    'bedrock:RetrieveAndGenerate',
    'bedrock:Retrieve',
    'bedrock:StartIngestionJob',
    'bedrock:GetIngestionJob',
    'bedrock:ListIngestionJobs',
    'bedrock:CreateDataSource',
    'bedrock:DeleteDataSource',
    'bedrock:GetDataSource'
  ],
  resources: ['arn:aws:bedrock:*:*:knowledge-base/*']
}));

// S3 Vectors permissions (query only, no create/delete index)
executionRole.addToPolicy(new iam.PolicyStatement({
  actions: [
    's3vectors:GetVectors',
    's3vectors:QueryVectors',
    's3vectors:ListVectors'
  ],
  resources: [kbVectorBucket.attrVectorBucketArn, `${kbVectorBucket.attrVectorBucketArn}/*`]
}));

// Environment variables for application
environment: {
  KB_ID: sharedKnowledgeBase.attrKnowledgeBaseId,
  DATA_SOURCE_ID: sharedDataSource.attrDataSourceId,
  KB_CATALOG_TABLE: kbCatalogTable.tableName,  // NEW
  KB_DOCS_BUCKET: kbDocumentsBucket.bucketName
}
```

---

## Decision 8: Frontend Integration

**Decision**: Add Knowledge Base tools to tools-config.json as a new tool group with nested tools.

**Configuration**:
```json
{
  "id": "knowledge_base_tools",
  "name": "Knowledge Base",
  "description": "Create and query personal document catalogs",
  "category": "knowledge",
  "icon": "library_books",
  "enabled": true,
  "isDynamic": true,
  "tools": [
    {"id": "create_catalog", "name": "Create Catalog"},
    {"id": "list_catalogs", "name": "List Catalogs"},
    {"id": "upload_to_catalog", "name": "Upload Document"},
    {"id": "query_catalog", "name": "Query Catalog"},
    // ... other tools
  ]
}
```

---

## Decision 9: Migration Strategy (NEW 2026-02-05)

**Decision**: No migration required.

**Rationale**:
- Knowledge Base feature is not yet in production
- Existing test data in `users-v2` can be discarded
- Clean slate approach simplifies implementation
- New table starts fresh with correct schema

---

## Technical Dependencies

| Dependency | Version | Purpose |
|------------|---------|---------|
| boto3 | 1.34+ | AWS SDK for Bedrock KB APIs |
| strands-agents | existing | Tool decorator and context |
| aws-cdk-lib | 2.x | Infrastructure as code |

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Bedrock KB cold start latency | Pre-warm with scheduled queries |
| Ingestion job failures | Retry logic with exponential backoff |
| Large file uploads | Presigned URLs for direct S3 upload |
| Vector cleanup on delete | Delete S3 objects + trigger KB re-sync to remove orphaned vectors |
| Metadata filter performance | Ensure user_id and catalog_id are indexed for filtering |
| Cross-tenant data leakage | Strict metadata filtering validation; audit logging |

---

## References

- [Bedrock Knowledge Base Documentation](https://docs.aws.amazon.com/bedrock/latest/userguide/knowledge-base.html)
- Existing codebase patterns:
  - `chatbot-app/agentcore/src/builtin_tools/word_document_tool.py`
  - `chatbot-app/agentcore/src/workspace/base_manager.py`
  - `agent-blueprint/agentcore-runtime-stack/lib/agent-runtime-stack.ts`
