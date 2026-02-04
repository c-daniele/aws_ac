# Tool API Contracts: Knowledge Base Agent

**Feature**: 001-knowledge-base-agent
**Date**: 2026-02-03

## Overview

These contracts define the Knowledge Base tools that will be registered with the Strands Agent framework. Each tool follows the existing pattern using the `@tool(context=True)` decorator.

---

## Tool 1: create_catalog

Creates a new knowledge base catalog for the user. Catalogs are logical containers stored in DynamoDB with a dedicated Bedrock data source pointing to the catalog's S3 path. Documents are indexed into the shared Knowledge Base with metadata filtering.

### Signature

```python
@tool(context=True)
def create_catalog(
    catalog_name: str,
    description: str = "",
    tool_context: ToolContext = None
) -> Dict[str, Any]
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| catalog_name | str | Yes | Name for the catalog (1-100 chars, alphanumeric + spaces/hyphens) |
| description | str | No | Optional description (max 500 chars) |

### Response

```json
{
  "content": [{"text": "Created catalog 'Project Research' (ID: cat-abc123). Ready for document uploads."}],
  "status": "success",
  "metadata": {
    "catalog_id": "cat-abc123",
    "catalog_name": "Project Research",
    "data_source_id": "ds-xyz789",
    "s3_prefix": "user-123/cat-abc123/",
    "tool_type": "knowledge_base"
  }
}
```

### Error Responses

| Error | Message |
|-------|---------|
| Duplicate name | "A catalog named 'X' already exists" |
| Invalid name | "Catalog name contains invalid characters" |
| Limit exceeded | "Maximum catalog limit (100) reached" |

---

## Tool 2: list_catalogs

Lists all catalogs owned by the current user.

### Signature

```python
@tool(context=True)
def list_catalogs(
    tool_context: ToolContext = None
) -> Dict[str, Any]
```

### Parameters

None (user_id extracted from context)

### Response

```json
{
  "content": [{
    "text": "Found 3 catalogs:\n\n1. **Project Research** (cat-abc123)\n   - 12 documents, 45.2 MB\n   - Status: ready\n   - Last updated: 2026-02-03\n\n2. **Meeting Notes** (cat-def456)\n   - 5 documents, 2.1 MB\n   - Status: indexing\n   - Last updated: 2026-02-02"
  }],
  "status": "success",
  "metadata": {
    "catalog_count": 3,
    "catalogs": [
      {
        "catalog_id": "cat-abc123",
        "catalog_name": "Project Research",
        "document_count": 12,
        "total_size_mb": 45.2,
        "indexing_status": "ready"
      }
    ]
  }
}
```

---

## Tool 3: upload_to_catalog

Uploads a document to a specified catalog.

### Signature

```python
@tool(context=True)
def upload_to_catalog(
    catalog_id: str,
    file_content: str,
    filename: str,
    tool_context: ToolContext = None
) -> Dict[str, Any]
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| catalog_id | str | Yes | Target catalog ID |
| file_content | str | Yes | Base64-encoded file content |
| filename | str | Yes | Original filename with extension |

### Response

```json
{
  "content": [{"text": "Uploaded 'report.pdf' to catalog 'Project Research'. Indexing started."}],
  "status": "success",
  "metadata": {
    "document_id": "doc-xyz789",
    "catalog_id": "cat-abc123",
    "filename": "report.pdf",
    "file_size_kb": 1250,
    "indexing_status": "pending",
    "tool_type": "knowledge_base"
  }
}
```

### Error Responses

| Error | Message |
|-------|---------|
| Catalog not found | "Catalog 'cat-xxx' not found" |
| Invalid file type | "File type '.exe' not supported. Allowed: pdf, docx, txt, md, csv" |
| File too large | "File exceeds 50MB limit" |
| Duplicate file | "File 'report.pdf' already exists. Use replace=true to overwrite" |

---

## Tool 4: list_catalog_documents

Lists all documents in a specific catalog.

### Signature

```python
@tool(context=True)
def list_catalog_documents(
    catalog_id: str,
    tool_context: ToolContext = None
) -> Dict[str, Any]
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| catalog_id | str | Yes | Catalog to list documents from |

### Response

```json
{
  "content": [{
    "text": "Catalog 'Project Research' contains 3 documents:\n\n| Filename | Size | Status | Uploaded |\n|----------|------|--------|----------|\n| report.pdf | 1.2 MB | indexed | 2026-02-03 |\n| notes.docx | 256 KB | indexed | 2026-02-02 |\n| data.csv | 89 KB | indexing | 2026-02-03 |"
  }],
  "status": "success",
  "metadata": {
    "catalog_id": "cat-abc123",
    "document_count": 3,
    "documents": [
      {
        "document_id": "doc-001",
        "filename": "report.pdf",
        "file_size_kb": 1250,
        "indexing_status": "indexed",
        "uploaded_at": "2026-02-03T10:30:00Z"
      }
    ]
  }
}
```

---

## Tool 5: delete_catalog_document

Deletes a document from a catalog and removes its vectors.

### Signature

```python
@tool(context=True)
def delete_catalog_document(
    catalog_id: str,
    document_id: str,
    tool_context: ToolContext = None
) -> Dict[str, Any]
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| catalog_id | str | Yes | Catalog containing the document |
| document_id | str | Yes | Document to delete |

### Response

```json
{
  "content": [{"text": "Deleted 'report.pdf' from catalog. Vector cleanup initiated."}],
  "status": "success",
  "metadata": {
    "document_id": "doc-xyz789",
    "filename": "report.pdf",
    "vectors_removed": true
  }
}
```

### Notes

- Deletes S3 object and metadata.json
- Triggers Bedrock KB re-sync to remove vectors
- Updates catalog document_count

---

## Tool 6: select_catalog

Sets the active catalog for RAG queries in the current session.

### Signature

```python
@tool(context=True)
def select_catalog(
    catalog_id: str,
    tool_context: ToolContext = None
) -> Dict[str, Any]
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| catalog_id | str | Yes | Catalog to activate (or "none" to deselect) |

### Response

```json
{
  "content": [{"text": "Selected catalog 'Project Research' for queries. Ask me anything about your documents!"}],
  "status": "success",
  "metadata": {
    "catalog_id": "cat-abc123",
    "catalog_name": "Project Research",
    "document_count": 12,
    "active": true
  }
}
```

---

## Tool 7: query_catalog

Performs a RAG query against the shared Bedrock Knowledge Base, filtered by user_id and catalog_id metadata.

### Signature

```python
@tool(context=True)
def query_catalog(
    query: str,
    catalog_id: str = None,
    num_results: int = 5,
    tool_context: ToolContext = None
) -> Dict[str, Any]
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| query | str | Yes | Natural language query |
| catalog_id | str | No | Catalog to query (uses selected if not provided) |
| num_results | int | No | Max sources to retrieve (default: 5, max: 20) |

### Response

```json
{
  "content": [{
    "text": "Based on your documents:\n\nThe main causes of climate change include greenhouse gas emissions from fossil fuels, deforestation, and industrial processes. According to 'climate-report.pdf', CO2 levels have increased by 50% since pre-industrial times.\n\n**Sources:**\n1. climate-report.pdf (page 12)\n2. research-summary.docx (section 3)"
  }],
  "status": "success",
  "metadata": {
    "query": "What are the main causes of climate change?",
    "sources": [
      {
        "filename": "climate-report.pdf",
        "chunk_text": "CO2 levels have increased...",
        "relevance_score": 0.92
      }
    ],
    "catalog_id": "cat-abc123"
  }
}
```

### Error Responses

| Error | Message |
|-------|---------|
| No catalog selected | "No catalog selected. Use select_catalog first or specify catalog_id" |
| Catalog empty | "Catalog has no indexed documents" |
| No results | "No relevant information found for your query" |

---

## Tool 8: delete_catalog

Deletes an entire catalog, its Bedrock data source, all documents, and removes associated vectors from the shared Knowledge Base.

### Signature

```python
@tool(context=True)
def delete_catalog(
    catalog_id: str,
    confirm: bool = False,
    tool_context: ToolContext = None
) -> Dict[str, Any]
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| catalog_id | str | Yes | Catalog to delete |
| confirm | bool | Yes | Must be True to proceed |

### Response

```json
{
  "content": [{"text": "Deleted catalog 'Project Research' and all 12 documents. Data source and vectors removed."}],
  "status": "success",
  "metadata": {
    "catalog_id": "cat-abc123",
    "documents_deleted": 12,
    "storage_freed_mb": 45.2,
    "data_source_deleted": true,
    "vectors_cleanup_initiated": true
  }
}
```

---

## Tool 9: get_indexing_status

Checks the indexing status of documents in a catalog.

### Signature

```python
@tool(context=True)
def get_indexing_status(
    catalog_id: str,
    tool_context: ToolContext = None
) -> Dict[str, Any]
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| catalog_id | str | Yes | Catalog to check |

### Response

```json
{
  "content": [{
    "text": "Catalog 'Project Research' indexing status:\n\n- **Overall**: indexing (2 of 3 documents ready)\n- report.pdf: indexed\n- notes.docx: indexed\n- data.csv: indexing (45% complete)"
  }],
  "status": "success",
  "metadata": {
    "catalog_id": "cat-abc123",
    "overall_status": "indexing",
    "documents": {
      "indexed": 2,
      "indexing": 1,
      "pending": 0,
      "failed": 0
    }
  }
}
```

---

## Tool 10: download_from_catalog

Downloads a document from a catalog via presigned URL.

### Signature

```python
@tool(context=True)
def download_from_catalog(
    catalog_id: str,
    document_id: str,
    tool_context: ToolContext = None
) -> Dict[str, Any]
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| catalog_id | str | Yes | Catalog containing the document |
| document_id | str | Yes | Document to download |

### Response

```json
{
  "content": [{"text": "Download link for 'report.pdf' (expires in 15 minutes): [link]"}],
  "status": "success",
  "metadata": {
    "document_id": "doc-xyz789",
    "filename": "report.pdf",
    "download_url": "https://s3.amazonaws.com/...",
    "expires_in_seconds": 900
  }
}
```

### Error Responses

| Error | Message |
|-------|---------|
| Document not found | "Document 'doc-xxx' not found in catalog" |
| Catalog not found | "Catalog 'cat-xxx' not found" |

---

## Common Response Patterns

### Success Response

```json
{
  "content": [{"text": "Human-readable success message"}],
  "status": "success",
  "metadata": {
    "tool_type": "knowledge_base",
    ...additional_fields
  }
}
```

### Error Response

```json
{
  "content": [{"text": "Error: Description of what went wrong"}],
  "status": "error",
  "metadata": {
    "error_code": "CATALOG_NOT_FOUND",
    "error_details": "..."
  }
}
```

---

## Frontend Configuration

```json
{
  "id": "knowledge_base_tools",
  "name": "Knowledge Base",
  "description": "Create, manage, and query personal document catalogs (10 tools)",
  "category": "knowledge",
  "icon": "📚",
  "enabled": true,
  "isDynamic": true,
  "systemPromptGuidance": "Knowledge Base Best Practices:\n\n1. **Creating catalogs**: Use descriptive names for organization\n2. **Uploading**: Supported formats are PDF, DOCX, TXT, MD, CSV (max 50MB)\n3. **Querying**: Select a catalog first, then ask natural language questions\n4. **Citations**: Responses include source documents and page references\n5. **Maintenance**: Delete outdated documents to keep results relevant",
  "tags": ["knowledge", "documents", "research", "rag"],
  "tools": [
    {"id": "create_catalog", "name": "Create Catalog", "displayName": {"running": "Creating catalog", "complete": "Catalog created"}},
    {"id": "list_catalogs", "name": "List Catalogs", "displayName": {"running": "Listing catalogs", "complete": "Listed catalogs"}},
    {"id": "upload_to_catalog", "name": "Upload Document", "displayName": {"running": "Uploading document", "complete": "Document uploaded"}},
    {"id": "list_catalog_documents", "name": "List Documents", "displayName": {"running": "Listing documents", "complete": "Listed documents"}},
    {"id": "delete_catalog_document", "name": "Delete Document", "displayName": {"running": "Deleting document", "complete": "Document deleted"}},
    {"id": "select_catalog", "name": "Select Catalog", "displayName": {"running": "Selecting catalog", "complete": "Catalog selected"}},
    {"id": "query_catalog", "name": "Query Catalog", "displayName": {"running": "Querying knowledge base", "complete": "Query complete"}},
    {"id": "delete_catalog", "name": "Delete Catalog", "displayName": {"running": "Deleting catalog", "complete": "Catalog deleted"}},
    {"id": "get_indexing_status", "name": "Check Indexing", "displayName": {"running": "Checking status", "complete": "Status retrieved"}},
    {"id": "download_from_catalog", "name": "Download Document", "displayName": {"running": "Generating download link", "complete": "Download ready"}}
  ]
}
```
