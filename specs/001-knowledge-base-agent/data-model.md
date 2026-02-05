# Data Model: Knowledge Base Agent

**Feature**: 001-knowledge-base-agent
**Date**: 2026-02-03
**Last Updated**: 2026-02-05 (Data Model Refactor)

## Entity Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                              USER                                    │
│  (from Cognito - user_id used for tenant isolation)                 │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ 1:N (one user owns many catalogs)
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                            CATALOG                                   │
│  Table: {project}-kb-catalog                                        │
│  PK: catalog_id                                                     │
│  SK: METADATA                                                       │
│  ─────────────────────────────────────────────────────────────────  │
│  catalog_id: STRING (UUID)                                          │
│  user_id: STRING (GSI partition key)                                │
│  catalog_name: STRING                                               │
│  description: STRING (optional)                                     │
│  data_source_id: STRING (Bedrock KB data source ID)                 │
│  s3_prefix: STRING (user_id/catalog_id/)                            │
│  created_at: NUMBER (epoch ms)                                      │
│  updated_at: NUMBER (epoch ms)                                      │
│  document_count: NUMBER                                             │
│  total_size_bytes: NUMBER                                           │
│  indexing_status: ENUM (pending|indexing|ready|error)               │
│  last_sync_at: NUMBER (epoch ms, optional)                          │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ 1:N (one catalog contains many documents)
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                           DOCUMENT                                   │
│  Table: {project}-kb-catalog (same table as Catalog)                │
│  PK: catalog_id                                                     │
│  SK: DOC#{document_id}                                              │
│  ─────────────────────────────────────────────────────────────────  │
│  document_id: STRING (UUID)                                         │
│  catalog_id: STRING (same as PK)                                    │
│  user_id: STRING (denormalized for GSI)                             │
│  filename: STRING                                                   │
│  file_type: STRING (pdf, docx, txt, md, csv)                       │
│  file_size_bytes: NUMBER                                            │
│  s3_key: STRING                                                     │
│  uploaded_at: NUMBER (epoch ms)                                     │
│  indexed_at: NUMBER (epoch ms, optional)                            │
│  indexing_status: ENUM (uploading|pending|indexing|indexed|failed)  │
│  error_message: STRING (optional, for failed status)                │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ 1:N (one document has many vector chunks)
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        VECTOR_ENTRY                                  │
│  (Managed by Bedrock Knowledge Base - S3 Vector Bucket)             │
│  ─────────────────────────────────────────────────────────────────  │
│  vector: FLOAT32[] (1024 dimensions, Titan embeddings)              │
│  text: STRING (chunk content)                                       │
│  metadata:                                                          │
│    - filename: STRING (for citations)                               │
|    - user_id: STRING (Cognito user ID)                              │
|    - catalog_id: STRING (Catalog ID)                                │
└─────────────────────────────────────────────────────────────────────┘
```

---

## DynamoDB Table Design

### Table: `{project}-kb-catalog`

**Why a dedicated table?** (Decision 2026-02-05)
- Clean separation from user/session data in `users-v2`
- Independent scaling and capacity management
- Clearer access patterns optimized for catalog operations
- Catalog + documents in same partition for efficient queries

**Key Schema**:
| Key | Type | Description |
|-----|------|-------------|
| `catalog_id` | String | Partition key - catalog identifier |
| `sk` | String | Sort key - `METADATA` or `DOC#{document_id}` |

**GSI: `user_id-index`**:
| Key | Type | Description |
|-----|------|-------------|
| `user_id` | String | Partition key - Cognito user ID |
| Projection | KEYS_ONLY | Returns catalog_id + sk only |

**Billing Mode**: On-demand (PAY_PER_REQUEST)

---

## Entity Definitions

### 1. Catalog

A named container for related documents belonging to a user. Catalogs are isolated via metadata filtering against the single shared Knowledge Base.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| catalog_id | STRING | Yes | UUID, auto-generated (partition key) |
| sk | STRING | Yes | Sort key: `METADATA` |
| user_id | STRING | Yes | Cognito user identifier (GSI key) |
| catalog_name | STRING | Yes | User-provided name (1-100 chars) |
| description | STRING | No | Optional description (max 500 chars) |
| data_source_id | STRING | Yes | Bedrock KB data source ID for this catalog |
| s3_prefix | STRING | Yes | S3 path prefix: `{user_id}/{catalog_id}/` |
| created_at | NUMBER | Yes | Unix epoch milliseconds |
| updated_at | NUMBER | Yes | Unix epoch milliseconds |
| document_count | NUMBER | Yes | Number of documents (denormalized) |
| total_size_bytes | NUMBER | Yes | Total storage used (denormalized) |
| indexing_status | STRING | Yes | Overall catalog status |
| last_sync_at | NUMBER | No | Last Bedrock KB sync time |

**Validation Rules**:
- `catalog_name`: Alphanumeric, spaces, hyphens, underscores only
- `catalog_name`: Unique per user (case-insensitive)
- `description`: Plain text, no HTML

**State Transitions**:
```
┌─────────┐     Document      ┌──────────┐     Sync       ┌─────────┐
│ pending │ ──────────────▶   │ indexing │ ──────────▶    │  ready  │
└─────────┘     uploaded      └──────────┘   complete     └─────────┘
     │                              │                          │
     │                              │                          │
     │                              ▼                          │
     │                        ┌─────────┐                      │
     └───────────────────────▶│  error  │◀─────────────────────┘
           any failure        └─────────┘    sync failure
```

---

### 2. Document

A file uploaded to a catalog.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| catalog_id | STRING | Yes | Parent catalog (partition key) |
| sk | STRING | Yes | Sort key: `DOC#{document_id}` |
| document_id | STRING | Yes | UUID, auto-generated on upload |
| user_id | STRING | Yes | Cognito user ID (denormalized) |
| filename | STRING | Yes | Original filename |
| file_type | STRING | Yes | Extension (pdf, docx, txt, md, csv) |
| file_size_bytes | NUMBER | Yes | File size in bytes |
| s3_key | STRING | Yes | Full S3 object key |
| uploaded_at | NUMBER | Yes | Unix epoch milliseconds |
| indexed_at | NUMBER | No | When indexing completed |
| indexing_status | STRING | Yes | Document processing status |
| error_message | STRING | No | Error details if failed |

**Validation Rules**:
- `file_type`: Must be in allowed list (pdf, docx, txt, md, csv)
- `file_size_bytes`: Max 50MB (52,428,800 bytes)
- `filename`: Max 255 chars, no path separators

**State Transitions**:
```
┌───────────┐     S3 upload    ┌─────────┐     metadata    ┌──────────┐
│ uploading │ ────────────▶    │ pending │ ────────────▶   │ indexing │
└───────────┘     complete     └─────────┘     created     └──────────┘
                                                                │
                     ┌──────────────────────────────────────────┤
                     │                                          │
                     ▼                                          ▼
               ┌─────────┐                                ┌─────────┐
               │ indexed │                                │ failed  │
               └─────────┘                                └─────────┘
```

---

### 3. Vector Entry (Bedrock-managed)

An embedded chunk of document content stored for retrieval. Managed entirely by Bedrock Knowledge Base in S3 Vector Bucket.

| Field | Type | Description |
|-------|------|-------------|
| vector | FLOAT32[] | Embedding vector (1024 dimensions for Titan) |
| text | STRING | Source text chunk |
| metadata.filename | STRING | For source citations |
| metadata.user_id | STRING | Cognito user ID |
| metadata.catalog_id | STRING | Catalog ID |

**Notes**:
- Chunks are created automatically by Bedrock during ingestion
- Default chunk size: ~300 tokens with 10% overlap
- Vectors stored in single shared S3 Vector Bucket with cosine distance metric
- Metadata filtering (user_id, catalog_id) enforces multi-tenant isolation at query time

---

### 4. Session Catalog Selection (Ephemeral)

Tracks which catalog is selected for RAG queries in the current session.

| Field | Type | Description |
|-------|------|-------------|
| session_id | STRING | Current session identifier |
| selected_catalog_id | STRING | Currently active catalog (null if none) |
| selected_at | NUMBER | When selection was made |

**Storage**: In-memory or session state (not persisted to DynamoDB)

---

## DynamoDB Access Patterns

### Table: `{project}-kb-catalog`

| Access Pattern | Operation | Key Condition | Notes |
|----------------|-----------|---------------|-------|
| Get catalog metadata | GetItem | `PK=catalog_id, SK=METADATA` | Direct lookup |
| List documents in catalog | Query | `PK=catalog_id, SK begins_with DOC#` | Single partition |
| List user's catalogs | Query (GSI) | `user_id-index: user_id=X` | Returns KEYS_ONLY |
| Get document by ID | GetItem | `PK=catalog_id, SK=DOC#{doc_id}` | Direct lookup |
| Delete catalog + docs | Query + BatchDelete | `PK=catalog_id` | All items in partition |

### Query Examples

```python
# Table reference
table_name = f"{project_name}-kb-catalog"
table = dynamodb.Table(table_name)

# Get catalog metadata
response = table.get_item(
    Key={
        'catalog_id': catalog_id,
        'sk': 'METADATA'
    }
)

# List documents in a catalog
response = table.query(
    KeyConditionExpression='catalog_id = :cid AND begins_with(sk, :prefix)',
    ExpressionAttributeValues={
        ':cid': catalog_id,
        ':prefix': 'DOC#'
    }
)

# List user's catalogs (via GSI)
response = table.query(
    IndexName='user_id-index',
    KeyConditionExpression='user_id = :uid',
    ExpressionAttributeValues={
        ':uid': user_id
    }
)
# Note: Returns only catalog_id + sk; fetch full details with GetItem if needed

# Get specific document
response = table.get_item(
    Key={
        'catalog_id': catalog_id,
        'sk': f'DOC#{document_id}'
    }
)

# Delete all items in a catalog (documents + metadata)
# First query all items, then batch delete
response = table.query(
    KeyConditionExpression='catalog_id = :cid',
    ExpressionAttributeValues={':cid': catalog_id}
)
with table.batch_writer() as batch:
    for item in response['Items']:
        batch.delete_item(Key={'catalog_id': item['catalog_id'], 'sk': item['sk']})
```

---

## S3 Storage Structure

```
s3://{project}-kb-docs-{account}-{region}/
└── {user_id}/
    └── {catalog_id}/
        ├── {document_id}-report.pdf
        ├── {document_id}-report.pdf.metadata.json
        ├── {document_id}-notes.docx
        └── {document_id}-notes.docx.metadata.json
```

### Metadata File Schema

```json
{
  "metadataAttributes": {
    "user_id": {"value": {"type": "STRING", "stringValue": "cognito-sub-xxx"}},
    "catalog_id": {"value": {"type": "STRING", "stringValue": "cat-abc123"}},
    "document_id": {"value": {"type": "STRING", "stringValue": "doc-def456"}},
    "filename": {"value": {"type": "STRING", "stringValue": "report.pdf"}}
  }
}
```

---

## Indexing Status Values

| Status | Entity | Description |
|--------|--------|-------------|
| `uploading` | Document only | File being uploaded to S3 |
| `pending` | Both | Waiting for ingestion job |
| `indexing` | Both | Bedrock ingestion in progress |
| `indexed` | Document | Successfully indexed |
| `ready` | Catalog | All documents indexed |
| `failed` | Both | Ingestion failed |
| `error` | Catalog | One or more docs failed |

---

## Constraints Summary

| Entity | Constraint | Value |
|--------|-----------|-------|
| Catalog | Max per user | 100 |
| Catalog | Name length | 1-100 chars |
| Catalog | Name uniqueness | Per user (case-insensitive) |
| Document | Max per catalog | 500 |
| Document | Max file size | 50 MB |
| Document | Allowed types | pdf, docx, txt, md, csv |
| Document | Filename length | 1-255 chars |
| Query | Max results | 20 (configurable) |
