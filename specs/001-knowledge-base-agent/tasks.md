# Tasks: Knowledge Base Agent - Data Model Refactor

**Input**: Design documents from `/specs/001-knowledge-base-agent/`
**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, contracts/tools-api.md ✓

**Key Change (2026-02-05)**: Data model refactored to use dedicated `{project}-kb-catalog` DynamoDB table instead of `users-v2`. See spec.md Clarifications Session 2026-02-05.

**Tests**: Per constitution, automated tests to be added later. Manual validation per quickstart.md.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- Include exact file paths in descriptions

## Path Conventions

- **Backend**: `chatbot-app/agentcore/src/`
- **Frontend**: `chatbot-app/frontend/src/`
- **Infrastructure**: `agent-blueprint/agentcore-runtime-stack/lib/`

---

## Phase 1: Setup (Infrastructure)

**Purpose**: CDK infrastructure for DynamoDB, S3, Bedrock KB, IAM permissions

### DynamoDB Table (NEW - Data Model Refactor)

- [X] T001 [P] Add DynamoDB table `{project}-kb-catalog` with PK=catalog_id, SK=sk in agent-blueprint/agentcore-runtime-stack/lib/agent-runtime-stack.ts
- [X] T002 [P] Add GSI `user_id-index` with PK=user_id, KEYS_ONLY projection in agent-blueprint/agentcore-runtime-stack/lib/agent-runtime-stack.ts
- [X] T003 [P] Configure table with PAY_PER_REQUEST billing mode in agent-blueprint/agentcore-runtime-stack/lib/agent-runtime-stack.ts
- [X] T004 [P] Add IAM permissions for kb-catalog table (GetItem, PutItem, UpdateItem, DeleteItem, Query) to execution role in agent-blueprint/agentcore-runtime-stack/lib/agent-runtime-stack.ts
- [X] T005 Add environment variable KB_CATALOG_TABLE to runtime environment in agent-blueprint/agentcore-runtime-stack/lib/agent-runtime-stack.ts

### S3 and Bedrock KB

- [X] T006 [P] Add S3 bucket for KB documents in agent-blueprint/agentcore-runtime-stack/lib/agent-runtime-stack.ts
- [X] T007 [P] Add S3 Vector Bucket resource (AWS::S3Vectors::VectorBucket) in agent-blueprint/agentcore-runtime-stack/lib/agent-runtime-stack.ts
- [X] T008 [P] Add S3 Vector Index resource (float32, 1024 dims, cosine) in agent-blueprint/agentcore-runtime-stack/lib/agent-runtime-stack.ts
- [X] T009 [P] Add Bedrock Knowledge Base resource (single shared KB, no default data source) in agent-blueprint/agentcore-runtime-stack/lib/agent-runtime-stack.ts
- [X] T010 [P] Add IAM role for Bedrock KB service with S3/S3Vectors/Bedrock model access in agent-blueprint/agentcore-runtime-stack/lib/agent-runtime-stack.ts
- [X] T011 [P] Add IAM permissions for application execution role (Retrieve, RetrieveAndGenerate, StartIngestionJob, GetIngestionJob, CreateDataSource, DeleteDataSource) in agent-blueprint/agentcore-runtime-stack/lib/agent-runtime-stack.ts
- [X] T012 Add environment variables (KB_ID, KB_DOCS_BUCKET) to runtime environment in agent-blueprint/agentcore-runtime-stack/lib/agent-runtime-stack.ts

### Verification

- [X] T013 Verify CDK synth completes without errors

**Checkpoint**: Infrastructure ready - deploy with `./deploy.sh --runtime`

---

## Phase 2: Foundational (Backend Core - Data Model Update)

**Purpose**: Update manager class to use new dedicated `{project}-kb-catalog` table with new key schema

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### Table Reference Update

- [X] T014 Update table_name from `{project}-users-v2` to `{project}-kb-catalog` in chatbot-app/agentcore/src/workspace/kb_catalog_manager.py
- [X] T015 Add KB_CATALOG_TABLE environment variable fallback in chatbot-app/agentcore/src/workspace/kb_catalog_manager.py

### Key Schema Update (NEW)

- [X] T016 Update create_catalog_record() to use PK=catalog_id, SK=METADATA instead of PK=userId, SK=CATALOG#{id} in chatbot-app/agentcore/src/workspace/kb_catalog_manager.py
- [X] T017 Update create_document_record() to use PK=catalog_id, SK=DOC#{document_id} instead of PK=userId, SK=DOCUMENT#{catalog_id}#{document_id} in chatbot-app/agentcore/src/workspace/kb_catalog_manager.py
- [X] T018 Update get_catalog() to use Key={catalog_id, sk=METADATA} in chatbot-app/agentcore/src/workspace/kb_catalog_manager.py
- [X] T019 Update get_document() to use Key={catalog_id, sk=DOC#{document_id}} in chatbot-app/agentcore/src/workspace/kb_catalog_manager.py
- [X] T020 Update list_user_catalogs() to query GSI user_id-index instead of PK=userId in chatbot-app/agentcore/src/workspace/kb_catalog_manager.py
- [X] T021 Update list_documents_in_catalog() to use PK=catalog_id, SK begins_with DOC# in chatbot-app/agentcore/src/workspace/kb_catalog_manager.py
- [X] T022 Update delete_catalog_record() to use Key={catalog_id, sk=METADATA} in chatbot-app/agentcore/src/workspace/kb_catalog_manager.py
- [X] T023 Update delete_document_record() to use Key={catalog_id, sk=DOC#{document_id}} in chatbot-app/agentcore/src/workspace/kb_catalog_manager.py
- [X] T024 Update update_catalog_status() to use Key={catalog_id, sk=METADATA} in chatbot-app/agentcore/src/workspace/kb_catalog_manager.py
- [X] T025 Update update_document_status() to use Key={catalog_id, sk=DOC#{document_id}} in chatbot-app/agentcore/src/workspace/kb_catalog_manager.py
- [X] T026 Update update_catalog_document_count() to use Key={catalog_id, sk=METADATA} in chatbot-app/agentcore/src/workspace/kb_catalog_manager.py

### Attribute Updates

- [X] T027 Add user_id as regular attribute (for GSI) in catalog records in chatbot-app/agentcore/src/workspace/kb_catalog_manager.py
- [X] T028 Add user_id as regular attribute (denormalized) in document records in chatbot-app/agentcore/src/workspace/kb_catalog_manager.py

### Validation

- [X] T029 Update validate_catalog_name() to query GSI for uniqueness check per user in chatbot-app/agentcore/src/workspace/kb_catalog_manager.py

### Existing Tools (No Changes Needed)

- [X] T030 Verify knowledge_base_tools.py imports work with updated manager in chatbot-app/agentcore/src/builtin_tools/knowledge_base_tools.py
- [X] T031 Verify KB tools export in chatbot-app/agentcore/src/builtin_tools/__init__.py

**Checkpoint**: Foundation ready - manager class uses new table schema

---

## Phase 3: User Story 1 - Create and Populate a Knowledge Base Catalog (Priority: P1) 🎯 MVP

**Goal**: Users can create a catalog, upload documents, and see indexing status

**Independent Test**: Create a catalog named "Test Research", upload a PDF, verify it shows "indexed" status

### Implementation for User Story 1

- [X] T032 [US1] Implement _create_data_source() helper for Bedrock data source creation in chatbot-app/agentcore/src/workspace/kb_catalog_manager.py
- [X] T033 [US1] Implement create_catalog tool following contracts/tools-api.md in chatbot-app/agentcore/src/builtin_tools/knowledge_base_tools.py
- [X] T034 [US1] Implement upload_document() to upload file to S3 with proper path structure ({user_id}/{catalog_id}/) in chatbot-app/agentcore/src/workspace/kb_catalog_manager.py
- [X] T035 [US1] Implement create_metadata_json() for companion metadata file with user_id, catalog_id, filename in chatbot-app/agentcore/src/workspace/kb_catalog_manager.py
- [X] T036 [US1] Implement start_ingestion() to trigger Bedrock ingestion job for catalog's data source in chatbot-app/agentcore/src/workspace/kb_catalog_manager.py
- [X] T037 [US1] Implement upload_to_catalog tool following contracts/tools-api.md in chatbot-app/agentcore/src/builtin_tools/knowledge_base_tools.py
- [X] T038 [US1] Implement get_ingestion_job_status() to check Bedrock ingestion job state in chatbot-app/agentcore/src/workspace/kb_catalog_manager.py
- [X] T039 [US1] Implement get_indexing_status tool following contracts/tools-api.md in chatbot-app/agentcore/src/builtin_tools/knowledge_base_tools.py
- [X] T040 [US1] Add error handling for file type validation (pdf, docx, txt, md, csv only) in chatbot-app/agentcore/src/builtin_tools/knowledge_base_tools.py
- [X] T041 [US1] Add error handling for file size validation (50MB max) in chatbot-app/agentcore/src/builtin_tools/knowledge_base_tools.py
- [X] T042 [US1] Add duplicate filename detection in upload_to_catalog with replace/rename prompt per edge case in chatbot-app/agentcore/src/builtin_tools/knowledge_base_tools.py

**Checkpoint**: User Story 1 complete - users can create catalogs, upload documents, and see indexing progress

---

## Phase 4: User Story 2 - Query Documents Using RAG (Priority: P2)

**Goal**: Users can select a catalog and ask questions with source citations

**Independent Test**: Select a catalog with indexed documents, query "What are the main topics?", verify response includes citations

### Implementation for User Story 2

- [X] T043 [US2] Implement set_selected_catalog() to store catalog selection in session state in chatbot-app/agentcore/src/workspace/kb_catalog_manager.py
- [X] T044 [US2] Implement get_selected_catalog() to retrieve current catalog selection in chatbot-app/agentcore/src/workspace/kb_catalog_manager.py
- [X] T045 [US2] Implement select_catalog tool following contracts/tools-api.md in chatbot-app/agentcore/src/builtin_tools/knowledge_base_tools.py
- [X] T046 [US2] Implement query_knowledge_base() using bedrock-agent-runtime retrieve with metadata filters (user_id, catalog_id) in chatbot-app/agentcore/src/workspace/kb_catalog_manager.py
- [X] T047 [US2] Implement format_citations() to extract and format source references from retrieval results in chatbot-app/agentcore/src/workspace/kb_catalog_manager.py
- [X] T048 [US2] Implement query_catalog tool following contracts/tools-api.md in chatbot-app/agentcore/src/builtin_tools/knowledge_base_tools.py
- [X] T049 [US2] Add error handling for no catalog selected case in chatbot-app/agentcore/src/builtin_tools/knowledge_base_tools.py
- [X] T050 [US2] Add error handling for empty catalog (no indexed documents) case in chatbot-app/agentcore/src/builtin_tools/knowledge_base_tools.py

**Checkpoint**: User Story 2 complete - users can query their documents with RAG and receive cited responses

---

## Phase 5: User Story 3 - Manage Catalog Contents (Priority: P3)

**Goal**: Users can view and manage documents within their catalogs

**Independent Test**: List documents in a catalog, delete one document, verify list updates and vectors are removed

### Implementation for User Story 3

- [X] T051 [US3] Implement list_catalog_documents tool following contracts/tools-api.md in chatbot-app/agentcore/src/builtin_tools/knowledge_base_tools.py
- [X] T052 [US3] Implement delete_s3_document() to remove document and metadata.json from S3 in chatbot-app/agentcore/src/workspace/kb_catalog_manager.py
- [X] T053 [US3] Implement trigger_vector_cleanup() to start re-sync ingestion job to remove orphaned vectors in chatbot-app/agentcore/src/workspace/kb_catalog_manager.py
- [X] T054 [US3] Implement delete_catalog_document tool following contracts/tools-api.md in chatbot-app/agentcore/src/builtin_tools/knowledge_base_tools.py
- [X] T055 [US3] Implement generate_download_url() to create presigned S3 URL for document download in chatbot-app/agentcore/src/workspace/kb_catalog_manager.py
- [X] T056 [US3] Implement download_from_catalog tool following contracts/tools-api.md pattern in chatbot-app/agentcore/src/builtin_tools/knowledge_base_tools.py

**Checkpoint**: User Story 3 complete - users can view document lists and delete individual documents

---

## Phase 6: User Story 4 - Browse and Select Catalogs (Priority: P4)

**Goal**: Users can view all their catalogs and delete entire catalogs

**Independent Test**: List all catalogs, delete one catalog, verify it and all its documents are removed

### Implementation for User Story 4

- [X] T057 [US4] Implement list_catalogs tool following contracts/tools-api.md in chatbot-app/agentcore/src/builtin_tools/knowledge_base_tools.py
- [X] T058 [US4] Implement delete_data_source() to remove Bedrock data source for catalog in chatbot-app/agentcore/src/workspace/kb_catalog_manager.py
- [X] T059 [US4] Implement delete_all_catalog_documents() to batch delete all documents for catalog from S3 and DynamoDB in chatbot-app/agentcore/src/workspace/kb_catalog_manager.py
- [X] T060 [US4] Implement delete_catalog tool with confirm parameter following contracts/tools-api.md in chatbot-app/agentcore/src/builtin_tools/knowledge_base_tools.py
- [X] T061 [US4] Add error handling for catalog not found case in chatbot-app/agentcore/src/builtin_tools/knowledge_base_tools.py

**Checkpoint**: User Story 4 complete - users can browse catalogs and delete entire catalogs

---

## Phase 7: Frontend Configuration

**Purpose**: Enable KB tools in the frontend UI

- [X] T062 Add knowledge_base_tools group with all 10 tools to chatbot-app/frontend/src/config/tools-config.json
- [X] T063 Add systemPromptGuidance for KB best practices in chatbot-app/frontend/src/config/tools-config.json
- [X] T064 Configure displayName states (running/complete) for each tool in chatbot-app/frontend/src/config/tools-config.json

**Checkpoint**: Frontend configured - tools visible in UI dropdown

---

## Phase 8: Polish & Verification

**Purpose**: Validation and documentation

- [ ] T065 Run quickstart.md Step 4 local testing sequence (list, create, upload)
- [ ] T066 Verify new DynamoDB table created with correct key schema (PK=catalog_id, SK=sk)
- [ ] T067 Verify GSI user_id-index created with KEYS_ONLY projection
- [ ] T068 Verify create_catalog creates record with SK=METADATA
- [ ] T069 Verify upload_to_catalog creates record with SK=DOC#{document_id}
- [ ] T070 Verify list_catalogs queries GSI user_id-index correctly
- [ ] T071 Verify list_documents queries PK=catalog_id, SK begins_with DOC#
- [ ] T072 Verify create_catalog creates Bedrock data source with correct S3 inclusion prefix
- [ ] T073 Verify upload_to_catalog creates metadata.json with user_id, catalog_id fields
- [ ] T074 Verify query_catalog returns results with proper source citations
- [ ] T075 Verify delete_catalog removes data source, S3 objects, and DynamoDB records
- [ ] T076 Verify multi-tenant isolation (user A cannot see user B's catalogs)
- [X] T077 Update __all__ exports in chatbot-app/agentcore/src/builtin_tools/__init__.py if any tools missing

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-6)**: All depend on Foundational phase completion
  - User stories can then proceed in priority order (P1 → P2 → P3 → P4)
  - Or in parallel if staffed (all can start after Foundational)
- **Frontend (Phase 7)**: Can start after Foundational, parallel to user stories
- **Polish (Phase 8)**: Depends on all user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - Requires catalogs to exist (can use test data)
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) - Requires documents to exist (can use test data)
- **User Story 4 (P4)**: Can start after Foundational (Phase 2) - No dependencies on other stories

### Key Tasks for Data Model Refactor

**PRIORITY**: These tasks must be completed first to enable the new table design:

1. T001-T005: Create new DynamoDB table with correct schema
2. T014-T029: Update manager class to use new key patterns

### Within Each User Story

- Manager methods before tool implementations
- Validation before happy path
- Error handling after core implementation

### Parallel Opportunities

- T001-T004, T006-T011 can run in parallel (different CDK constructs)
- T016-T026 can run in parallel (different manager methods, same file - batch update)
- T032-T035 can run in parallel (create_catalog prerequisites)
- T043-T044 can run in parallel (select_catalog prerequisites)
- T065-T076 can run in parallel (independent verification tests)

---

## Parallel Example: Foundational Phase (Data Model Update)

```bash
# These manager method updates can be batched together:
Task: "Update create_catalog_record() to use new key schema" (T016)
Task: "Update create_document_record() to use new key schema" (T017)
Task: "Update get_catalog() to use new key schema" (T018)
Task: "Update get_document() to use new key schema" (T019)
Task: "Update list_user_catalogs() to query GSI" (T020)
Task: "Update list_documents_in_catalog() to use new key schema" (T021)
# etc.
```

---

## Implementation Strategy

### MVP First (Data Model Refactor + User Story 1)

1. Complete Phase 1: Setup (CDK infrastructure with new DynamoDB table)
2. Complete Phase 2: Foundational (Update manager to use new key schema)
3. Complete Phase 3: User Story 1 (create catalog, upload, indexing status)
4. **STOP and VALIDATE**: Test via quickstart.md Step 4
5. Deploy/demo if ready

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready with new data model
2. Add User Story 1 → Test independently → Deploy/Demo (MVP!)
3. Add User Story 2 → Test RAG queries → Deploy/Demo
4. Add User Story 3 → Test document management → Deploy/Demo
5. Add User Story 4 → Test catalog management → Deploy/Demo
6. Add Frontend Config → Enable UI → Final validation

### Recommended Order

For a single developer working sequentially:
1. Phase 1 (T001-T013): Infrastructure (new DynamoDB table + existing resources)
2. Phase 2 (T014-T031): Foundational (update manager for new key schema)
3. Phase 3 (T032-T042): US1 - Create and Populate
4. Phase 4 (T043-T050): US2 - Query with RAG
5. Phase 5 (T051-T056): US3 - Manage Documents
6. Phase 6 (T057-T061): US4 - Browse Catalogs
7. Phase 7 (T062-T064): Frontend Config
8. Phase 8 (T065-T077): Polish & Verification

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- **Data Model Change**: Key difference from previous design is `catalog_id` as PK instead of `userId`
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence
