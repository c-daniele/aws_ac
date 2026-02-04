# Feature Specification: Knowledge Base Agent

**Feature Branch**: `001-knowledge-base-agent`
**Created**: 2026-02-03
**Status**: Draft
**Input**: User description: "Knowledge Base Agent for creating, querying and managing Knowledge Base Catalogs with file upload, indexing, and RAG analysis capabilities"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create and Populate a Knowledge Base Catalog (Priority: P1)

A user wants to create a personal knowledge base to store and query their documents. They create a new catalog, upload relevant documents (PDFs, Word docs, text files), and wait for the system to process and index the content for future retrieval.

**Why this priority**: This is the foundational capability that enables all other features. Without the ability to create catalogs and upload documents, no other functionality is useful.

**Independent Test**: Can be fully tested by creating a catalog, uploading a document, and verifying it appears in the catalog's file list with "indexed" status. Delivers immediate value as document storage with metadata.

**Acceptance Scenarios**:

1. **Given** a logged-in user with no existing catalogs, **When** they request to create a new catalog named "Project Research", **Then** the system creates the catalog and returns a confirmation with the catalog ID.

2. **Given** a user with an existing catalog, **When** they upload a PDF document to the catalog, **Then** the system accepts the file, stores it in the landing zone, and initiates the indexing process.

3. **Given** a user uploads a document, **When** they check the indexing status, **Then** they see progress through stages: "uploading" → "pending" → "indexing" → "indexed".

4. **Given** a user uploads an unsupported file type (e.g., .exe), **When** the upload is attempted, **Then** the system rejects the file with a clear error message listing supported formats.

---

### User Story 2 - Query Documents Using RAG (Priority: P2)

A user has populated their knowledge base and now wants to ask questions about the content. They select a catalog for RAG analysis and ask natural language questions, receiving answers grounded in their documents with source citations.

**Why this priority**: RAG querying is the primary value proposition - users create knowledge bases specifically to retrieve information via natural language queries.

**Independent Test**: Can be tested by selecting an indexed catalog and asking a question about known document content, verifying the response includes relevant information and citations.

**Acceptance Scenarios**:

1. **Given** a user with an indexed catalog containing documents about climate change, **When** they select the catalog and ask "What are the main causes of global warming?", **Then** the system returns an answer synthesized from the documents with source citations.

2. **Given** a user with multiple catalogs, **When** they switch from "Personal Notes" to "Work Projects" catalog, **Then** subsequent queries only search documents in the selected catalog.

3. **Given** a user queries a catalog, **When** the response is generated, **Then** each claim is attributed to specific source documents with page/section references where available.

4. **Given** a user asks a question not covered by their documents, **When** the query is processed, **Then** the system clearly indicates it cannot find relevant information in the selected catalog.

---

### User Story 3 - Manage Catalog Contents (Priority: P3)

A user needs to maintain their knowledge base over time - viewing what documents exist, downloading copies, and removing outdated files to keep the catalog current and accurate.

**Why this priority**: Content management ensures the knowledge base remains relevant. Less urgent than creation and querying but essential for long-term usage.

**Independent Test**: Can be tested by listing files in a catalog, downloading one file, and deleting another, then verifying the list updates correctly.

**Acceptance Scenarios**:

1. **Given** a user with a catalog containing 5 documents, **When** they request the file list, **Then** they see all 5 documents with names, sizes, upload dates, and indexing status.

2. **Given** a user viewing their catalog files, **When** they request to download "quarterly-report.pdf", **Then** the system provides a download link or streams the original file.

3. **Given** a user wants to remove an outdated document, **When** they delete "old-policy.docx", **Then** the system removes the file from storage AND removes all associated vectors from the vector database.

4. **Given** a user deletes the last document in a catalog, **When** the deletion completes, **Then** the catalog remains but shows as empty (ready for new documents).

---

### User Story 4 - Browse and Select Catalogs (Priority: P4)

A user with multiple knowledge bases needs to see all their catalogs, understand what each contains, and select the appropriate one for their current task.

**Why this priority**: Multi-catalog management becomes important as users build multiple knowledge bases for different purposes.

**Independent Test**: Can be tested by creating multiple catalogs and verifying the list displays all of them with accurate metadata.

**Acceptance Scenarios**:

1. **Given** a user with 3 catalogs, **When** they request the catalog list, **Then** they see all 3 catalogs with names, document counts, and last updated timestamps.

2. **Given** a user viewing their catalog list, **When** they select "Technical Documentation" for the current session, **Then** the system confirms the selection and subsequent queries use this catalog.

3. **Given** a user wants to remove an entire catalog, **When** they delete the catalog, **Then** all associated documents, vectors, and metadata are permanently removed.

---

### Edge Cases

- What happens when a user uploads a duplicate file (same name) to a catalog? System should ask whether to replace or rename.
- How does the system handle very large files (>50MB)? System should enforce size limits with clear error messages.
- What happens if indexing fails mid-process? System should mark the document as "failed" with retry option.
- How does the system behave when the vector database is temporarily unavailable? Graceful degradation with queued operations.
- What happens when a user tries to query an empty catalog? Clear message indicating no documents are indexed.
- What if a user tries to access another user's catalog? Access denied with appropriate error (user isolation enforced).

## Requirements *(mandatory)*

### Functional Requirements

**Catalog Management**
- **FR-001**: System MUST allow users to create new catalogs with a user-provided name
- **FR-002**: System MUST generate unique catalog IDs automatically upon creation
- **FR-002a**: System MUST create a dedicated Bedrock data source for each catalog pointing to the catalog's S3 path
- **FR-003**: System MUST allow users to list all their catalogs with metadata (name, document count, last updated)
- **FR-004**: System MUST allow users to delete catalogs, removing all associated data (files, vectors, metadata)
- **FR-004a**: System MUST delete the associated Bedrock data source when a catalog is deleted
- **FR-005**: System MUST enforce user isolation - users can only access their own catalogs via metadata filtering

**Document Upload and Storage**
- **FR-006**: System MUST accept document uploads in common formats (PDF, DOCX, TXT, MD, CSV)
- **FR-007**: System MUST store uploaded documents in a designated landing zone before processing
- **FR-008**: System MUST enforce maximum file size limits per upload
- **FR-009**: System MUST support uploading multiple files in a single operation
- **FR-010**: System MUST associate each uploaded document with the user ID, catalog ID, and original filename

**Document Indexing**
- **FR-011**: System MUST automatically initiate indexing when documents are uploaded
- **FR-012**: System MUST parse documents to extract text content
- **FR-013**: System MUST generate embeddings using the configured embedding model (Amazon Titan)
- **FR-014**: System MUST store vectors in S3 Vector Bucket with document metadata (filename, user ID, catalog ID)
- **FR-015**: System MUST provide real-time indexing status updates (uploading, parsing, embedding, indexed, failed)

**RAG Querying**
- **FR-016**: System MUST allow users to select a catalog for RAG queries in the current session
- **FR-017**: System MUST query the shared Bedrock Knowledge Base with metadata filters (user_id, catalog_id) to scope results
- **FR-018**: System MUST return source citations with query responses
- **FR-019**: System MUST clearly indicate when no relevant documents are found

**Document Management**
- **FR-020**: System MUST allow users to list all documents within a specific catalog
- **FR-021**: System MUST allow users to download original documents from their catalogs
- **FR-022**: System MUST allow users to delete individual documents from catalogs
- **FR-023**: System MUST remove associated vectors when a document is deleted

### Key Entities

- **Catalog**: A named container for related documents belonging to a user. Key attributes: catalog_id (auto-generated), user_id (owner), name (user-provided), data_source_id (Bedrock KB data source for this catalog), created_at, updated_at, document_count. Each catalog has a dedicated data source pointing to its S3 path, enabling concurrent ingestion. Catalogs are isolated via metadata filtering against the shared Knowledge Base.

- **Document**: A file uploaded to a catalog. Key attributes: document_id, catalog_id, user_id, filename, file_type, file_size, s3_key, indexing_status, uploaded_at, indexed_at.

- **User**: The authenticated individual interacting with the system. Identified by user_id from authentication system. Owns zero or more catalogs.

- **Vector Entry**: An embedded chunk of document content stored in the shared S3 Vector Bucket for retrieval. Contains: embedding vector, source document reference, chunk text, metadata (user_id, catalog_id, filename). Metadata filtering enforces tenant isolation.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can create a catalog and upload their first document in under 2 minutes
- **SC-002**: Document indexing completes within 5 minutes for files up to 10MB
- **SC-003**: RAG queries return relevant results in under 5 seconds for catalogs with up to 100 documents
- **SC-004**: 90% of user queries against indexed documents return at least one relevant source citation
- **SC-005**: Users can successfully complete the full workflow (create catalog → upload → query) on first attempt without errors
- **SC-006**: Document deletion removes all associated vectors within 30 seconds
- **SC-007**: System maintains strict user isolation - 0% cross-user data leakage in access controls
- **SC-008**: Indexing status updates are visible to users within 10 seconds of state changes

## Clarifications

### Session 2026-02-04

- Q: What is the Knowledge Base architecture? → A: Single shared Bedrock KB with metadata filtering (user_id, catalog_id) for multi-tenant isolation. AWS account limits require single KB, single S3 vector bucket, single index (supersedes previous 1:1 mapping)
- Q: How are data sources structured? → A: One data source per catalog. Each data source has a user/catalog-specific S3 source link (`s3://{bucket}/{user_id}/{catalog_id}/`). This enables concurrent ingestion jobs since each job is linked to a specific data source.

### Session 2026-02-03

- Q: Which vector store technology should be used? → A: S3 Vector Bucket (AWS::S3Vectors::VectorBucket), not OpenSearch Serverless
- Q: What is the relationship between Catalogs and Bedrock Knowledge Bases? → A: ~~1:1 mapping~~ SUPERSEDED - see Session 2026-02-04

## Assumptions

- Users authenticate via the existing Cognito authentication system, providing a reliable user_id
- The embedding model (AWS Titan) and vector storage (S3 Vector Bucket) are available and configured
- Vector index uses float32, 1024 dimensions, cosine distance metric (via AWS::S3Vectors::Index)
- File size limits will be set at 50MB per file based on typical document sizes
- Supported file formats limited to: PDF, DOCX, TXT, MD, CSV (common business document types)
- A single shared Bedrock Knowledge Base serves all users and catalogs (AWS account limit constraint)
- Each catalog has a dedicated Bedrock data source pointing to its S3 path (`{user_id}/{catalog_id}/`)
- Concurrent ingestion jobs are supported since each catalog has its own data source
- Multi-tenant isolation is enforced via metadata filtering (user_id, catalog_id) at query time
- Catalog names do not need to be globally unique, only unique per user
- Users will manage a reasonable number of catalogs (tens, not thousands)

## Out of Scope

- Sharing catalogs between users
- Real-time collaborative document editing
- Document versioning (only latest version stored)
- Automated document ingestion from external sources (email, cloud drives)
- Custom embedding model selection
- Advanced search operators (boolean, fuzzy matching)
- Document preview within the chat interface
- Batch catalog operations (bulk delete, bulk move)
