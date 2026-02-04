# Data Model: Knowledge Base Agent

**Feature**: 001-knowledge-base-agent
**Date**: 2026-02-03

## Entity Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                              USER                                    │
│  (from Cognito - user_id is the partition key)                      │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ 1:N (one user owns many catalogs)
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                            CATALOG                                   │
│  PK: user_id                                                        │
│  SK: CATALOG#{catalog_id}                                           │
│  ─────────────────────────────────────────────────────────────────  │
│  catalog_id: STRING (UUID)                                          │
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
│  PK: user_id                                                        │
│  SK: DOCUMENT#{catalog_id}#{document_id}                            │
│  ─────────────────────────────────────────────────────────────────  │
│  document_id: STRING (UUID)                                         │
│  catalog_id: STRING (FK to Catalog)                                 │
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

## Entity Definitions

### 1. Catalog

A named container for related documents belonging to a user. Catalogs are isolated via metadata filtering against the single shared Knowledge Base.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| user_id | STRING | Yes | Cognito user identifier (partition key) |
| sk | STRING | Yes | Sort key: `CATALOG#{catalog_id}` |
| catalog_id | STRING | Yes | UUID, auto-generated on creation |
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
| user_id | STRING | Yes | Cognito user identifier (partition key) |
| sk | STRING | Yes | Sort key: `DOCUMENT#{catalog_id}#{document_id}` |
| document_id | STRING | Yes | UUID, auto-generated on upload |
| catalog_id | STRING | Yes | Parent catalog reference |
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

### Primary Table: `{project}-users-v2`

| Access Pattern | Key Condition | Use Case |
|----------------|---------------|----------|
| Get catalog by ID | `PK=user_id, SK=CATALOG#{catalog_id}` | Load catalog details |
| List user's catalogs | `PK=user_id, SK begins_with CATALOG#` | Catalog listing |
| Get document by ID | `PK=user_id, SK=DOCUMENT#{catalog_id}#{doc_id}` | Load document |
| List catalog documents | `PK=user_id, SK begins_with DOCUMENT#{catalog_id}#` | Document listing |
| Delete catalog + docs | `PK=user_id, SK begins_with CATALOG#{id}` + batch delete docs | Cascade delete |

### Query Examples

```python
# List all catalogs for a user
response = table.query(
    KeyConditionExpression='userId = :uid AND begins_with(sk, :prefix)',
    ExpressionAttributeValues={
        ':uid': user_id,
        ':prefix': 'CATALOG#'
    }
)

# List documents in a catalog
response = table.query(
    KeyConditionExpression='userId = :uid AND begins_with(sk, :prefix)',
    ExpressionAttributeValues={
        ':uid': user_id,
        ':prefix': f'DOCUMENT#{catalog_id}#'
    }
)

# Get specific catalog
response = table.get_item(
    Key={
        'userId': user_id,
        'sk': f'CATALOG#{catalog_id}'
    }
)
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
  "user_id": "cognito-sub-xxx",
  "catalog_id": "cat-abc123",
  "document_id": "doc-def456",
  "filename": "report.pdf",
  "uploaded_at": "2026-02-03T10:30:00Z"
}
```

---

## Indexing Status Values

| Status | DynamoDB | Description |
|--------|----------|-------------|
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
